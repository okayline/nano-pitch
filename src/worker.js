// Daily Pitch Worker (nano-pitch).
//   GET  /api/today                    the UTC day and your hand: started (or carried on) from the day's deal, as far as
//                                      the bots have played; once it's done, the field (how everyone did on the same deal)
//   POST /api/act {day, n, action}     your next move: { type: "bid", bid: 0 | 2 | 3 | 4 } or { type: "play", card }.
//                                      n is how many moves the page has seen (a move from a stale tab is refused). The
//                                      server replays the day's deal plus your moves and plays the bots. The last move
//                                      seals the hand on the ledger and adds it to the field. New players: 3 an hour per address.
//   GET  /api/ledger?before=ID&limit=N the chain, newest first (N up to 100). Today's hands are hidden (everyone holds the
//                                      same cards); a past day's entry also shows its seed, so anyone can check the deal.
//   GET  /api/account, POST /api/codes, /api/load, /api/passkey, /api/logout: save codes and passkeys (shared Accounts)
//
// The deal comes from a secret seed (engine/daily.js); the day's ledger entry commits to it with its hash. The secret is
// made on first use and kept in pitch_meta. Every table here is pitch_..., because they share the moba-beat database.
// Players: a random token in an `np` cookie; only its SHA-256 is stored. Made on your first move (looking never makes one).
// The account code is copied from moba-beat src/worker.js (itself from dawn-baton).
import { dayEntry, entryInsert, seal, sha256 } from "./ledger.js";
import { dailySeed, seedHash } from "../engine/daily.js";
import { HUMAN, start, act as play, replay, view } from "../public/engine/pitch.js";

const GAME = "nano-pitch";
const COOKIE = "np";
const COOKIE_MAX_AGE = 400 * 86400;
const now = () => Math.floor(Date.now() / 1000);
const utcDay = () => new Date().toISOString().slice(0, 10);

class Oops extends Error { constructor(message, status = 400, extra = null) { super(message); this.status = status; this.extra = extra; } }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const body = async (req) => {
  let b;
  try { b = await req.json(); } catch {}
  if (!b || typeof b !== "object") throw new Oops("That request didn't make sense.");
  return b;
};

// ---------- the secret and the day ----------

// Kept per database binding for the life of this Worker instance, so each request doesn't read them again.
const cache = new WeakMap();
const cached = (env) => { let c = cache.get(env.DB); if (!c) cache.set(env.DB, (c = { secret: null, sealed: new Set() })); return c; };

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

async function today(env) {
  const day = utcDay(), seed = await dailySeed(await secret(env), day), sealed = cached(env).sealed;
  if (!sealed.has(day)) { await dayEntry(env.DB, day, await seedHash(seed), now()); sealed.add(day); }   // seen sealed: skip the read
  return { day, seed };
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

// ---------- the hand ----------

const handOf = (env, playerId, day) =>
  env.DB.prepare("SELECT actions, done FROM pitch_hands WHERE player_id = ? AND day = ?").bind(playerId, day).first();

const SCORE_COL = { "-4": "s_m4", "-3": "s_m3", "-2": "s_m2", "-1": "s_m1", 0: "s_0", 1: "s_p1", 2: "s_p2", 3: "s_p3", 4: "s_p4" };
const BID_COL = { 0: "b_0", 2: "b_2", 3: "b_3", 4: "b_4" };

async function fieldOf(env, day) {
  const r = await env.DB.prepare("SELECT * FROM pitch_days WHERE day = ?").bind(day).first();
  if (!r) return null;
  return {
    hands: r.hands,
    scores: [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((s) => r[SCORE_COL[s]]),   // how many finished on -4 .. +4
    bids: { 0: r.b_0, 2: r.b_2, 3: r.b_3, 4: r.b_4 },
    took: { high: r.p_high, low: r.p_low, jack: r.p_jack, game: r.p_game },
    pitched: r.pitched, made: r.made,
  };
}

// What the page gets: the day, how many moves it has seen, the hand as the human may see it, and the field once done.
async function answer(env, day, actions, state) {
  const done = state.phase === "done";
  return { day, n: actions.length, view: view(state), field: done ? await fieldOf(env, day) : null };
}

async function getToday(ctx) {
  const { env } = ctx, { day, seed } = await today(env);
  const me = await player(ctx), row = me ? await handOf(env, me.id, day) : null;
  const actions = row ? JSON.parse(row.actions) : [];
  return answer(env, day, actions, row ? replay(seed, actions) : start(seed));
}

// Only the fields a move needs, so nothing else can ride along into the ledger.
function cleanAction(a) {
  if (a && a.type === "bid" && [0, 2, 3, 4].includes(a.bid)) return { type: "bid", bid: a.bid };
  if (a && a.type === "play" && Number.isInteger(a.card) && a.card >= 0 && a.card < 52) return { type: "play", card: a.card };
  throw new Oops("That move didn't make sense.");
}

async function postAct(ctx) {
  const b = await body(ctx.req), { env } = ctx, { day, seed } = await today(env);
  if (b.day !== day) throw new Oops("That day's deal is over. A new one starts at midnight UTC.", 409);
  const action = cleanAction(b.action);
  const me = await player(ctx, true);
  const row = await handOf(env, me.id, day);
  const actions = row ? JSON.parse(row.actions) : [];
  const stale = async (msg) => { throw new Oops(msg, 409, await answer(env, day, actions, replay(seed, actions))); };
  if (row && row.done) await stale("Today's hand is already sealed.");
  if (b.n !== actions.length) await stale("This hand moved on in another tab.");
  let next;
  try { next = play(replay(seed, actions), action); }
  catch (e) { throw new Oops(e.message); }
  const moves = [...actions, action], t = now();

  // Not finished: save the moves, only if nobody else saved a move since this one was read.
  const save = env.DB.prepare(
    `INSERT INTO pitch_hands (player_id, day, actions, done, final, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (player_id, day) DO UPDATE SET actions = excluded.actions, done = excluded.done, final = excluded.final, updated_at = excluded.updated_at
     WHERE pitch_hands.done = 0 AND json_array_length(pitch_hands.actions) = ?`);
  if (next.phase !== "done") {
    const r = await save.bind(me.id, day, JSON.stringify(moves), 0, null, t, t, actions.length).run();
    if (!r.meta.changes) await stale("This hand moved on in another tab.");
    return answer(env, day, moves, next);
  }

  // Finished: the hand, its ledger entry and the field, in one batch.
  const res = next.result, mine = (seat) => (seat === HUMAN ? 1 : 0);
  const myBid = next.bids.find((x) => x.seat === HUMAN).bid;
  const pitched = mine(next.pitcher), made = pitched && res.made ? 1 : 0;
  const record = JSON.stringify({ day, player: me.id, actions: moves, pitcher: next.pitcher, bid: next.bid, points: res.points, final: res.final[HUMAN] });
  const sc = SCORE_COL[res.final[HUMAN]], bc = BID_COL[myBid];
  const field = env.DB.prepare(
    `INSERT INTO pitch_days (day, hands, ${sc}, ${bc}, p_high, p_low, p_jack, p_game, pitched, made) VALUES (?, 1, 1, 1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET hands = hands + 1, ${sc} = ${sc} + 1, ${bc} = ${bc} + 1,
       p_high = p_high + excluded.p_high, p_low = p_low + excluded.p_low, p_jack = p_jack + excluded.p_jack, p_game = p_game + excluded.p_game,
       pitched = pitched + excluded.pitched, made = made + excluded.made`)
    .bind(day, mine(res.high), mine(res.low), mine(res.jack), mine(res.gameWinner), pitched, made);
  const sealed = await seal(env.DB, async (prev) => {
    const { hash, stmt } = await entryInsert(env.DB, prev, { kind: "hand", day, playerId: me.id, record, t });
    return { hash, stmts: [save.bind(me.id, day, JSON.stringify(moves), 1, res.final[HUMAN], t, t, actions.length), stmt, field] };
  });
  if (sealed.duplicate) await stale("Today's hand is already sealed.");
  return { ...(await answer(env, day, moves, next)), hash: sealed.hash };
}

async function ledger(ctx) {
  const url = new URL(ctx.req.url), day = utcDay(), env = ctx.env;
  const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const { results } = await env.DB.prepare("SELECT id, kind, day, record, prev_hash, hash, created_at FROM pitch_ledger WHERE id < ? ORDER BY id DESC LIMIT ?").bind(before, limit).all();
  const key = results.some((e) => e.kind === "day" && e.day < day) ? await secret(env) : null;
  const entries = [];
  for (const e of results) {
    if (e.kind === "hand" && e.day >= day) entries.push({ ...e, record: null });   // today's hands: shown once the day is over
    else if (e.kind === "day" && e.day < day) entries.push({ ...e, seed: await dailySeed(key, e.day) });
    else entries.push(e);
  }
  return { entries };
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
  return { player: true, id: me.id, codes: ways.codes, passkeys: ways.passkeys, devices };
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
  "GET /api/today": getToday, "POST /api/act": postAct, "GET /api/ledger": ledger,
  "GET /api/account": account, "POST /api/codes": codes, "POST /api/load": loadCode, "POST /api/passkey": passkey, "POST /api/logout": logout,
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
