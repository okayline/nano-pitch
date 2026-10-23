// Nano Pitch Worker.
//   GET  /api/game                     your game (numbered, or the day's Daily game: { game, daily, day, ... }): the one in
//                                      progress, else your last finished one, else today's Daily game, else game 1 (first to 11
//                                      points over as many hands as it takes), as far as the bots have played; once it's over,
//                                      the field (how everyone who finished that game placed)
//   POST /api/play                     the next game, once your current one is finished: today's Daily game if you haven't
//                                      started it (the same deal for everyone that UTC day), else the next number
//   POST /api/act {game, daily, n, action}    your next move: { type: "bid", bid: 0 | 2 | 3 | 4 } or { type: "play", card }.
//                                      n is how many moves the page has seen (a move from a stale tab is refused). The
//                                      server replays the game's deals plus your moves and plays the bots. The move that ends
//                                      the game seals it on the ledger and adds it to the field. New players: 3 an hour per address.
//   GET  /api/ledger?before=ID&limit=N the chain, newest first (N up to 100). Entries from before v0.9 (kinds day, game,
//                                      practice, hand): today's are hidden (everyone held the same cards); a past day's entry
//                                      also shows its seed. Results (kind 'result') are public: a game's number, who finished,
//                                      the totals, and a hash of their moves, never the deal or the cards.
//   GET  /api/account, POST /api/codes, /api/load, /api/passkey, /api/logout: save codes and passkeys (shared Accounts)
//   POST /api/pfp                      the player's own profile pic, one of the emoji in PFP_POOL (the account answer gives it)
//   POST /api/name                     a new random name for the player (names can't be typed; account also gives one)
//
// Games are numbered 1, 2, 3...: the number fixes the deal (a seed from the server's secret) and the table's memory of bids
// as it stood when the game was first asked for (pitch_deals). Every player plays the same sequence at their own pace, so
// everyone who plays game N holds the same cards. The secret is made on first use and kept in pitch_meta. Every table here is
// pitch_..., because they share the moba-beat database.
// Players: a random token in an `np` cookie; only its SHA-256 is stored. Made on your first move (looking never makes one).
// The account code is copied from moba-beat src/worker.js (itself from dawn-baton).
// After every seal, the ledger's entry count and newest hash go to the shared registry as a checkpoint (REGISTRY), so the
// registry's Bitcoin stamp covers Pitch's ledger too.
import { entryInsert, seal, sha256 } from "./ledger.js";
import { giveName } from "./names.js";
import { dailySeed, gameSeed, dailyNo, dayOfDaily, utcDay } from "../engine/daily.js";
import { verifyTip } from "../public/chain.js";
import { HUMAN, PFP_POOL, SUITS, startGame, actGame, replayGame, viewGame } from "../public/engine/pitch.js";

const GAME = "nano-pitch";
const COOKIE = "np";
const COOKIE_MAX_AGE = 400 * 86400;
const now = () => Math.floor(Date.now() / 1000);

class Oops extends Error { constructor(message, status = 400, extra = null) { super(message); this.status = status; this.extra = extra; } }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const body = async (req) => {
  let b;
  try { b = await req.json(); } catch {}
  if (!b || typeof b !== "object") throw new Oops("That request didn't make sense.");
  return b;
};

// ---------- the secret and the deals ----------

// Kept per database binding for the life of this Worker instance, so each request doesn't read them again.
const cache = new WeakMap();
const cached = (env) => { let c = cache.get(env.DB); if (!c) cache.set(env.DB, (c = { secret: null, deals: new Map() })); return c; };

async function secret(env) {
  const c = cached(env);
  if (c.secret) return c.secret;
  let row = await env.DB.prepare("SELECT value FROM pitch_meta WHERE key = 'secret'").first();
  if (!row) {
    const fresh = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("INSERT OR IGNORE INTO pitch_meta (key, value) VALUES ('secret', ?)").bind(fresh).run();
    row = await env.DB.prepare("SELECT value FROM pitch_meta WHERE key = 'secret'").first();   // another request may have won
  }
  return (c.secret = row.value);
}

// The two kinds of game. A numbered game (kind "game", 1, 2, 3...) and the Daily game (kind "daily", numbered by UTC day: Daily
// game #1 is DAILY_START). They work the same way, each kind in its own tables: a player's games, and each game's deal (the
// memory snapshot and the field). A sealed numbered game is a 'result' entry on the ledger, a sealed Daily game a 'daily' one.
const KINDS = {
  game: { games: "pitch_games", deals: "pitch_deals", entry: "result", seed: (secret, n) => gameSeed(secret, n) },
  daily: { games: "pitch_daily_games", deals: "pitch_daily_deals", entry: "daily", seed: (secret, n) => dailySeed(secret, dayOfDaily(n)) },
};

// A game's deal: its seed, and the table's memory of bids as it stood when the game was first asked for. Taken once, from the
// running counts, and never changed after, so the bots (and every saved game's replay) stay the same for everyone who plays it.
// A Daily game's snapshot is taken by the first player that day, so everyone that day faces the same bots.
async function dealFor(env, kind, n) {
  const c = cached(env).deals, K = KINDS[kind], key = kind + ":" + n;
  if (c.has(key)) return c.get(key);
  const read = () => env.DB.prepare(`SELECT memory FROM ${K.deals} WHERE n = ?`).bind(n).first();
  let row = await read();
  if (!row) {
    const { results } = await env.DB.prepare("SELECT k, bid, n FROM pitch_crowd_counts").all();
    const mem = {};
    for (const r of results) (mem[r.k] ??= {})[r.bid] = r.n;
    await env.DB.prepare(`INSERT OR IGNORE INTO ${K.deals} (n, memory, created_at) VALUES (?, ?, ?)`).bind(n, JSON.stringify(mem), now()).run();
    row = await read();   // another request may have won
  }
  const deal = { seed: await K.seed(await secret(env), n), memory: JSON.parse(row.memory) };
  c.set(key, deal);
  return deal;
}

// What a sealed game adds to the memory: how many times each hand type got each bid (the human's, never a forced 2).
function crowdStmts(env, history) {
  const counts = new Map();
  for (const h of history) if (h.crowd) { const k = h.crowd.key + "|" + h.crowd.bid; counts.set(k, (counts.get(k) || 0) + 1); }
  return [...counts].map(([k, n]) => {
    const i = k.lastIndexOf("|");
    return env.DB.prepare("INSERT INTO pitch_crowd_counts (k, bid, n) VALUES (?, ?, ?) ON CONFLICT (k, bid) DO UPDATE SET n = n + excluded.n")
      .bind(k.slice(0, i), Number(k.slice(i + 1)), n);
  });
}

// ---------- players ----------

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const readCookie = (req) => { const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)np=([A-Za-z0-9_-]{20,})/); return m ? m[1] : null; };
const cookieFor = (token) => `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
const CLEAR_COOKIE = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

async function player(ctx, create = false) {
  const { env } = ctx, token = readCookie(ctx.req);
  if (token) {
    const h = await sha256(token);
    let p = await env.DB.prepare("SELECT id FROM pitch_players WHERE token_hash = ?").bind(h).first();
    if (!p) {
      p = await env.DB.prepare("SELECT player_id AS id FROM pitch_sessions WHERE token_hash = ?").bind(h).first();
      if (p) await env.DB.prepare("UPDATE pitch_sessions SET seen_at = ? WHERE token_hash = ?").bind(now(), h).run();
    }
    if (p) return p;
  }
  if (!create) return null;
  if (!(await rateLimit(env, ctx.req, "new-guest", 3, 3600))) throw new Oops("Too many new players from here. Try again later.", 429);
  const fresh = newToken();
  const row = await env.DB.prepare("INSERT INTO pitch_players (token_hash, created_at) VALUES (?, ?) RETURNING id").bind(await sha256(fresh), now()).first();
  ctx.setCookie = cookieFor(fresh);
  return row;
}
const must = async (ctx) => { const p = await player(ctx); if (!p) throw new Oops("No player here.", 401); return p; };

// ---------- the game ----------
// A player's game is a numbered one or a Daily one: { kind, n }. Once a UTC day, the first game a player starts is that day's
// Daily game, the same deal for everyone that day; a game already under way is finished first. Then numbered games, as many as
// they like.

const lastOf = (env, kind, playerId) =>
  env.DB.prepare(`SELECT n, actions, done, updated_at FROM ${KINDS[kind].games} WHERE player_id = ? ORDER BY n DESC LIMIT 1`).bind(playerId).first();

async function fieldOf(env, kind, n) {
  const r = await env.DB.prepare(`SELECT * FROM ${KINDS[kind].deals} WHERE n = ?`).bind(n).first();
  if (!r) return null;
  return { games: r.games, hands: r.hands, places: [r.place_1, r.place_2, r.place_3, r.place_4] };
}

// The game a player starts next, once nothing is under way: today's Daily game if they haven't started it, else the numbered
// game after their last (game 1 if they have none).
function nextOf(rows) {
  const today = dailyNo();
  if (!rows.daily || rows.daily.n < today) return { kind: "daily", n: today };
  return { kind: "game", n: rows.game ? rows.game.n + 1 : 1 };
}

// What the page gets: which game (its number, and whether it is a Daily game and its day), how many moves it has seen, the game
// as the human may see it, the field once it's over, and then which game comes next.
async function answer(env, cur, actions, game) {
  const daily = cur.kind === "daily";
  return {
    game: cur.n, daily, day: daily ? dayOfDaily(cur.n) : null, n: actions.length, view: viewGame(game),
    field: game.over ? await fieldOf(env, cur.kind, cur.n) : null,
    next: game.over && cur.rows ? nextOf({ ...cur.rows, [cur.kind]: { n: cur.n } }) : null,
  };
}

// A game rebuilt from its deal and the saved moves. If those moves no longer replay (the bots or rules changed since they were
// made), an unfinished game starts over; a finished one can't be shown again (null).
async function build(env, me, kind, n, row, rows) {
  const { seed, memory } = await dealFor(env, kind, n), base = { kind, n, seed, memory, rows };
  if (!row) return { ...base, row: null, actions: [], game: startGame(seed, memory), reset: false };
  const actions = JSON.parse(row.actions);
  try { return { ...base, row, actions, game: replayGame(seed, actions, memory), reset: false }; }
  catch {
    if (row.done) return null;
    await env.DB.prepare(`UPDATE ${KINDS[kind].games} SET actions = '[]', updated_at = ? WHERE player_id = ? AND n = ? AND done = 0`).bind(now(), me.id, n).run();
    return { ...base, row: { ...row, actions: "[]" }, actions: [], game: startGame(seed, memory), reset: true };
  }
}

// The player's current game: one under way (a Daily game first), else the one they finished last, else the next one, fresh.
// Someone with no player yet sees today's Daily game.
async function current(env, me) {
  if (!me) return build(env, null, "daily", dailyNo(), null, null);
  const rows = { daily: await lastOf(env, "daily", me.id), game: await lastOf(env, "game", me.id) };
  for (const kind of ["daily", "game"]) if (rows[kind] && !rows[kind].done) return build(env, me, kind, rows[kind].n, rows[kind], rows);
  const last = ["daily", "game"].filter((k) => rows[k]).sort((a, b) => rows[b].updated_at - rows[a].updated_at)[0];
  const shown = last && (await build(env, me, last, rows[last].n, rows[last], rows));
  if (shown) return shown;
  const next = nextOf(rows);
  return build(env, me, next.kind, next.n, null, rows);
}

async function getGame(ctx) {
  const cur = await current(ctx.env, await player(ctx));
  return { ...(await answer(ctx.env, cur, cur.actions, cur.game)), ...(cur.reset ? { reset: true } : {}) };
}

// The next game, once the current one is finished: today's Daily game if the player hasn't started it, else the next number.
// An unfinished one is given back instead.
async function play(ctx) {
  const { env } = ctx, me = await must(ctx), cur = await current(env, me);
  if (!cur.row || !cur.row.done) return answer(env, cur, cur.actions, cur.game);
  if (!(await rateLimit(env, ctx.req, "play", 30, 3600))) throw new Oops("Too many new games from here. Try again later.", 429);
  const next = nextOf(cur.rows), t = now();
  const fresh = await build(env, me, next.kind, next.n, null, cur.rows);
  await env.DB.prepare(`INSERT OR IGNORE INTO ${KINDS[next.kind].games} (player_id, n, actions, done, created_at, updated_at) VALUES (?, ?, '[]', 0, ?, ?)`).bind(me.id, next.n, t, t).run();
  return answer(env, fresh, [], fresh.game);
}

// Only the fields a move needs, so nothing else can ride along into the ledger.
function cleanAction(a) {
  if (a && a.type === "bid" && [0, 2, 3, 4].includes(a.bid)) return { type: "bid", bid: a.bid };
  if (a && a.type === "play" && Number.isInteger(a.card) && a.card >= 0 && a.card < 52) return { type: "play", card: a.card };
  throw new Oops("That move didn't make sense.");
}

async function postAct(ctx) {
  const b = await body(ctx.req), { env } = ctx, action = cleanAction(b.action);
  const me = await player(ctx, true), cur = await current(env, me), { kind, n, row, actions } = cur, K = KINDS[kind];
  const stale = async (msg) => { throw new Oops(msg, 409, await answer(env, cur, actions, cur.game)); };
  if (b.game !== n || !!b.daily !== (kind === "daily")) await stale("You're on another game now.");
  if (row && row.done) await stale("That game is already sealed.");
  if (b.n !== actions.length) await stale("This game moved on in another tab.");
  let next;
  try { next = actGame(cur.game, action); }
  catch (e) { throw new Oops(e.message); }
  const moves = [...actions, action], t = now();

  // Not finished: save the moves, only if nobody else saved a move since this one was read.
  const save = (done, final) => env.DB.prepare(
    `INSERT INTO ${K.games} (player_id, n, actions, done, final, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (player_id, n) DO UPDATE SET actions = excluded.actions, done = excluded.done, final = excluded.final, updated_at = excluded.updated_at
     WHERE done = 0 AND json_array_length(actions) = ?`).bind(me.id, n, JSON.stringify(moves), done, final, t, t, actions.length);
  if (!next.over) {
    const r = await save(0, null).run();
    if (!r.meta.changes) await stale("This game moved on in another tab.");
    return answer(env, cur, moves, next);
  }

  // Finished: the game, its ledger entry and the field, in one batch. A numbered game's record is { game, ... } as before; a
  // Daily game's is { daily, day, ... }.
  const mine = next.totals[HUMAN], place = 1 + next.totals.filter((x) => x > mine).length, pc = `place_${place}`;
  const which = kind === "daily" ? { daily: n, day: dayOfDaily(n) } : { game: n };
  const record = JSON.stringify({ ...which, player: me.id, moves: await sha256(JSON.stringify(moves)), hands: next.history.length, totals: next.totals, place });
  const field = env.DB.prepare(`UPDATE ${K.deals} SET games = games + 1, hands = hands + ?, ${pc} = ${pc} + 1 WHERE n = ?`).bind(next.history.length, n);
  const sealed = await seal(env.DB, async (prev) => {
    const { hash, stmt } = await entryInsert(env.DB, prev, { kind: K.entry, day: utcDay(), playerId: me.id, game: n, record, t });
    return { hash, stmts: [save(1, mine), stmt, field, ...crowdStmts(env, next.history)] };
  });
  if (sealed.duplicate) await stale("That game is already sealed.");
  ctx.waitUntil(checkpoint(env, gameDetail(kind, n, next, place)));
  return { ...(await answer(env, { ...cur, rows: cur.rows || { daily: null, game: null } }, moves, next)), hash: sealed.hash };
}

async function ledger(ctx) {
  const url = new URL(ctx.req.url), day = utcDay(), env = ctx.env;
  const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const { results } = await env.DB.prepare("SELECT id, kind, day, record, prev_hash, hash, created_at FROM pitch_ledger WHERE id < ? ORDER BY id DESC LIMIT ?").bind(before, limit).all();
  const key = results.some((e) => e.kind === "day" && e.day < day) ? await secret(env) : null;
  const entries = [];
  for (const e of results) {
    if (!["day", "result", "daily"].includes(e.kind) && e.day >= day) entries.push({ ...e, record: null });   // from before v0.9: today's games (and older hands) are shown once the day is over
    else if (e.kind === "day" && e.day < day) entries.push({ ...e, seed: await dailySeed(key, e.day) });
    else entries.push(e);
  }
  return { entries };
}

// ---------- the registry checkpoint ----------

// The ledger so far goes to the shared registry: its entry count and newest hash, which covers every entry before it. A
// registry that's away never stops a game: the next checkpoint covers it. It reads only the newest two entries (verifyTip),
// so it costs the same however long the ledger is. Entries are never deleted, so the newest id is the entry count.
// (Copied from moba-beat src/worker.js, itself from aura-farm.)
export async function checkpoint(env, detail) {
  try {
    if (!env.REGISTRY) return;
    const rows = (await env.DB.prepare("SELECT id, record, prev_hash, hash FROM pitch_ledger ORDER BY id DESC LIMIT 2").all()).results.reverse();
    if (!rows.length) return;
    const last = rows[rows.length - 1], v = await verifyTip(rows);
    if (!v.ok) return console.error("The ledger is broken at entry " + v.at + ": no checkpoint sent.");
    const res = await env.REGISTRY.checkpoint({ game: GAME, entries: last.id, head: last.hash, ...(detail ? { detail } : {}) });
    if (res && res.error) console.error("The registry refused the checkpoint: " + res.error);
  } catch (e) { console.error(e); }
}

// The public facts a finished game adds to its checkpoint, for the registry's ledger page: which game, how it ended, and what
// the human did at each hand. Never a player. The registry takes up to 12 keys of whole numbers, short words, or lists of up
// to 24 of them (so a long game shows its first 24 hands).
export function gameDetail(kind, n, g, place) {
  const mine = g.history.filter((h) => h.pitcher === HUMAN);
  const first = (f) => g.history.slice(0, 24).map(f);
  return {
    kind, game: n, ...(kind === "daily" ? { day: dayOfDaily(n) } : {}),
    hands: g.history.length, place, score: g.totals[HUMAN], top: Math.max(...g.totals),
    pitched: mine.length, made: mine.filter((h) => h.made).length,
    bids: first((h) => h.bids.find((b) => b.seat === HUMAN).bid),
    trumps: first((h) => SUITS[h.trump]),
    pitchers: first((h) => h.pitcher),
  };
}

// ---------- save codes and passkeys (kept by the shared Accounts service in dungeon-items) ----------

const ACC = (env) => { if (!env.ACCOUNTS) throw new Oops("Accounts are unavailable right now. Try again in a moment.", 503); return env.ACCOUNTS; };
const ipOf = (req) => req.headers.get("cf-connecting-ip") || "unknown";
const ok = (r) => { if (r && r.error) throw new Oops(r.error, r.status || 400); return r; };

// Fixed window per hashed IP and action. Returns true if allowed.
async function rateLimit(env, req, action, limit, windowSecs) {
  const key = action + ":" + (await sha256("ip:" + ipOf(req))).slice(0, 32);
  const t = now(), windowStart = t - (t % windowSecs);
  const row = await env.DB.prepare(
    `INSERT INTO pitch_rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`).bind(key, windowStart).first();
  return row.count <= limit;
}

async function accountFor(env, me, make = false) {
  const acc = ACC(env);
  let id = (await acc.accountOf(GAME, me.id)).accountId;
  if (id || !make) return id ?? null;
  id = (await acc.createAccount()).accountId;
  if (!ok(await acc.link(id, GAME, me.id)).linked) throw new Oops("That didn't work. Try again.");
  return id;
}

// Log this browser in as the account's player here: the one it already has, else this browser's own player (if it has
// no account yet), else a new one. The browser gets its own session token.
async function enter(ctx, accountId) {
  const { env } = ctx, acc = ACC(env);
  let { playerId } = await acc.playerFor(accountId, GAME);
  if (!playerId) {
    const cur = await player(ctx);
    if (cur && !(await acc.accountOf(GAME, cur.id)).accountId) playerId = cur.id;
    else {
      if (!(await rateLimit(env, ctx.req, "new-player", 20, 3600))) throw new Oops("Too many new players from here. Try again later.", 429);
      playerId = (await env.DB.prepare("INSERT INTO pitch_players (token_hash, created_at) VALUES (?, ?) RETURNING id").bind(await sha256(newToken()), now()).first()).id;
    }
    playerId = ok(await acc.link(accountId, GAME, playerId)).playerId;
  }
  const token = newToken();
  await env.DB.prepare("INSERT INTO pitch_sessions (token_hash, player_id, created_at, seen_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), playerId, now(), now()).run();
  ctx.setCookie = cookieFor(token);
}

async function account(ctx) {
  const me = await player(ctx);
  if (!me) return { player: false, codes: [], passkeys: [], devices: 0 };
  const id = await accountFor(ctx.env, me);
  const ways = id ? ok(await ACC(ctx.env).info(id)) : { codes: [], passkeys: [] };
  const devices = 1 + (await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM pitch_sessions WHERE player_id = ?").bind(me.id).first()).n;
  const row = await ctx.env.DB.prepare("SELECT name, pfp FROM pitch_players WHERE id = ?").bind(me.id).first();
  return { player: true, id: me.id, name: await giveName(ctx.env, me.id, row?.name), pfp: row?.pfp ?? null, codes: ways.codes, passkeys: ways.passkeys, devices };
}

// The player's own profile pic, one of the pool.
async function setPfp(ctx) {
  const me = await must(ctx), b = await body(ctx.req);
  if (!PFP_POOL.includes(b.pfp)) throw new Oops("That isn't one of the profile pics.");
  await ctx.env.DB.prepare("UPDATE pitch_players SET pfp = ? WHERE id = ?").bind(b.pfp, me.id).run();
  return { pfp: b.pfp };
}

// A new random name for the player (names can't be typed).
async function reroll(ctx) {
  const me = await must(ctx);
  if (!(await rateLimit(ctx.env, ctx.req, "name", 30, 3600))) throw new Oops("Too many name changes from here. Try again later.", 429);
  const row = await ctx.env.DB.prepare("SELECT name FROM pitch_players WHERE id = ?").bind(me.id).first();
  return { name: await giveName(ctx.env, me.id, row?.name, { reroll: true }) };
}

async function codes(ctx) {
  const b = await body(ctx.req);
  if (b.action === "new") {
    const me = await player(ctx, true);
    return { code: ok(await ACC(ctx.env).addCode(await accountFor(ctx.env, me, true))).code };
  }
  if (b.action === "remove") {
    const me = await must(ctx), id = await accountFor(ctx.env, me);
    if (!id) throw new Oops("No such save code.", 404);
    ok(await ACC(ctx.env).removeCode(id, Number(b.id)));
    return { ok: true };
  }
  throw new Oops("Unknown action.");
}

async function loadCode(ctx) {
  const r = ok(await ACC(ctx.env).loginCode({ code: (await body(ctx.req)).code, ip: ipOf(ctx.req) }));
  await enter(ctx, r.accountId);
  return { ok: true };
}

async function passkey(ctx) {
  const b = await body(ctx.req), { env, req } = ctx, acc = ACC(env), origin = new URL(req.url).origin;
  if (b.action === "login_options") return ok(await acc.passkeyLoginOptions({ origin, ip: ipOf(req) }));
  if (b.action === "login") {
    const r = ok(await acc.passkeyLogin({ origin, ip: ipOf(req), credential: b.credential }));
    await enter(ctx, r.accountId);
    return { ok: true };
  }
  if (b.action === "register_options" || b.action === "register") {
    const me = await player(ctx, true), accountId = await accountFor(env, me, true);
    if (b.action === "register_options") return ok(await acc.passkeyRegisterOptions({ accountId, origin }));
    return ok(await acc.passkeyRegister({ accountId, origin, credential: b.credential, label: b.label }));
  }
  if (b.action === "remove") {
    const me = await must(ctx), id = await accountFor(env, me);
    if (!id) throw new Oops("No such passkey.", 404);
    return ok(await acc.passkeyRemove(id, Number(b.id)));
  }
  throw new Oops("Unknown action.");
}

// Log out: this browser forgets its player, but only once there's a save code or passkey to get back in.
async function logout(ctx) {
  const me = await player(ctx), { env } = ctx;
  if (!me) { ctx.setCookie = CLEAR_COOKIE; return { ok: true }; }
  const id = await accountFor(env, me);
  if (!(id ? await ACC(env).waysIn(id) : 0)) throw new Oops("Make a save code or passkey first, or you'd have no way back in.");
  const h = await sha256(readCookie(ctx.req));
  const s = await env.DB.prepare("DELETE FROM pitch_sessions WHERE token_hash = ?").bind(h).run();
  if (!s.meta.changes) await env.DB.prepare("UPDATE pitch_players SET token_hash = ? WHERE id = ? AND token_hash = ?").bind(await sha256(newToken()), me.id, h).run();
  ctx.setCookie = CLEAR_COOKIE;
  return { ok: true };
}

// ---------- routing ----------

const ROUTES = {
  "GET /api/game": getGame, "POST /api/play": play, "POST /api/act": postAct, "GET /api/ledger": ledger,
  "GET /api/account": account, "POST /api/codes": codes, "POST /api/load": loadCode, "POST /api/passkey": passkey, "POST /api/logout": logout, "POST /api/name": reroll, "POST /api/pfp": setPfp,
};

export default {
  async fetch(req, env, ectx) {
    const url = new URL(req.url), route = ROUTES[req.method + " " + url.pathname];
    if (!route) return json({ error: "Not found." }, 404);
    const ctx = { req, env, waitUntil: (p) => ectx?.waitUntil?.(p), setCookie: null };
    try {
      const res = json(await route(ctx));
      if (ctx.setCookie) res.headers.append("set-cookie", ctx.setCookie);
      return res;
    } catch (e) {
      if (e instanceof Oops) {
        const res = json({ error: e.message, ...(e.extra || {}) }, e.status);
        if (ctx.setCookie) res.headers.append("set-cookie", ctx.setCookie);
        return res;
      }
      console.error(e);
      return json({ error: "Something broke. Try again in a moment." }, 500);
    }
  },
};
