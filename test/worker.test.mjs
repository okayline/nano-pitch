// The Worker against a D1 lookalike (Node's SQLite) and a stand-in for the shared Accounts. Expected values come from
// node:crypto and raw SQL, not from the code under test. The D1 and Accounts stand-ins are copied from moba-beat's tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";
import { startGame, viewGame } from "../public/engine/pitch.js";
import { dailyNo as dailyNoOf, dayOfDaily } from "../engine/daily.js";
import { castOf } from "../public/engine/pitch.js";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const prep = (sql, args = []) => ({
    sql, args,
    bind: (...a) => prep(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
  });
  const batch = async (stmts) => {
    db.exec("BEGIN");
    try { const out = stmts.map((st) => db.prepare(st.sql).run(...st.args)); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { prepare: (sql) => prep(sql), batch, raw: db };
}
const sha = (t) => createHash("sha256").update(t).digest("hex");
const GENESIS = "0".repeat(64);

function fakeAccounts() {
  let n = 0; const codes = new Map(), keys = new Map(), links = new Map();
  const err = (error, status = 400) => ({ error, status });
  const own = (id) => [...codes].filter(([, v]) => v.acct === id);
  return {
    async createAccount() { return { accountId: ++n }; },
    async addCode(id) { const code = "CODE-" + (codes.size + 1) + "-" + id; codes.set(code, { acct: id, id: codes.size + 1 }); return { code }; },
    async removeCode(id, cid) { const e = [...codes].find(([, v]) => v.acct === id && v.id === cid); if (!e) return err("No such save code.", 404); codes.delete(e[0]); return { ok: true }; },
    async loginCode({ code }) { const v = codes.get(code); return v ? { accountId: v.acct } : err("That save code didn't work. Check it and try again.", 404); },
    async info(id) { return { codes: own(id).map(([, v]) => ({ id: v.id, created_at: 1, last_used_at: null })), passkeys: [] }; },
    async waysIn(id) { return own(id).length; },
    async playerFor(id, g) { return { playerId: links.get(id + "|" + g) ?? null }; },
    async link(id, g, p) {
      if (links.has(id + "|" + g)) return { playerId: links.get(id + "|" + g), linked: links.get(id + "|" + g) === p };
      links.set(id + "|" + g, p); return { playerId: p, linked: true };
    },
    async accountOf(g, p) { const e = [...links].find(([k, v]) => k.endsWith("|" + g) && v === p); return { accountId: e ? Number(e[0].split("|")[0]) : null }; },
  };
}

function setup() {
  const DB = fakeD1();
  const checkpoints = [];
  const env = { DB, ACCOUNTS: fakeAccounts(), REGISTRY: { async checkpoint(c) { checkpoints.push(c); return { ok: true, created: true }; } } };
  const call = async (path, { body, cookie, ip = "1.2.3.4" } = {}) => {
    const later = [];
    const r = await worker.fetch(new Request("https://pitch.88x31.app" + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env, { waitUntil: (p) => later.push(p) });
    await Promise.all(later);   // the registry checkpoint runs after the answer
    const set = r.headers.get("set-cookie");
    return { status: r.status, cookie: set ? set.split(";")[0] : null, ...(await r.json()) };
  };
  return { env, call, raw: DB.raw, checkpoints };
}
const today = () => new Date().toISOString().slice(0, 10);
const first = (v) => (v.phase === "bid" ? { type: "bid", bid: v.bidOptions[0] } : { type: "play", card: v.legal[0] });   // the first allowed bid, else the first legal card
const secretOf = (raw) => raw.prepare("SELECT value FROM pitch_meta WHERE key = 'secret'").get().value;
const seedOf = (raw, n) => createHmac("sha256", secretOf(raw)).update("game:" + n).digest("hex");

// The body of a move for the game t shows.
const mv = (t, action) => ({ game: t.game, daily: !!t.daily, n: t.n, action });

// Plays the first allowed bid and the first legal card until the current game is over. Returns the last answer.
async function playThrough(call, cookie) {
  let t = await call("/api/game", { cookie }), c = cookie;
  while (!t.view.over) {
    const r = await call("/api/act", { body: mv(t, first(t.view)), cookie: c });
    assert.equal(r.status, 200, r.error);
    c = r.cookie || c;
    t = r;
  }
  return { t, cookie: c };
}

const dailyNo = () => Math.round((Date.parse(today() + "T00:00:00Z") - Date.parse("2026-10-23T00:00:00Z")) / 86400000) + 1;
const dailySeedOf = (raw, day) => createHmac("sha256", secretOf(raw)).update("daily:" + day).digest("hex");

test("Daily game numbers: #1 is 2026-10-23, one more each UTC day, the same for everyone", () => {
  assert.equal(dailyNoOf("2026-10-23"), 1);
  assert.equal(dailyNoOf("2026-10-24"), 2);
  assert.equal(dailyNoOf("2026-12-31"), 70);   // 8 days left in October + 30 in November + 31 in December + the first
  assert.equal(dayOfDaily(1), "2026-10-23");
  assert.equal(dayOfDaily(70), "2026-12-31");
});

test("looking at today's Daily game makes no player and no ledger entry, and its deal is the day's seed", async () => {
  const { call, raw } = setup();
  const t = await call("/api/game");
  assert.equal(t.status, 200);
  assert.equal(t.cookie, null);
  assert.equal(t.daily, true);
  assert.equal(t.game, dailyNo());
  assert.equal(t.day, today());
  assert.equal(t.n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_players").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_ledger").get().n, 0);
  assert.equal(t.view.hand.length, 6);
  assert.equal("hands" in t.view, false);
  assert.match(secretOf(raw), /^[0-9a-f]{64}$/);
  assert.deepEqual(t.view.hand, viewGame(startGame(dailySeedOf(raw, today()), {})).hand);   // the same deal anyone gets today (no counts yet: an empty memory)
  const deal = raw.prepare("SELECT * FROM pitch_daily_deals").all();
  assert.equal(deal.length, 1);
  assert.equal(deal[0].n, dailyNo());
  assert.equal(deal[0].memory, "{}");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_deals").get().n, 0);
  await call("/api/game");   // a second look makes nothing more
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_daily_deals").get().n, 1);
});

test("a whole Daily game: saved move by move, sealed once as a 'daily' entry without its cards, added to the day's field", async () => {
  const { call, raw } = setup();
  const { t, cookie } = await playThrough(call);
  assert.ok(cookie);
  const game = raw.prepare("SELECT * FROM pitch_daily_games").get();
  assert.equal(game.done, 1);
  assert.equal(game.n, dailyNo());
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_games").get().n, 0);   // not a numbered game
  const entries = raw.prepare("SELECT * FROM pitch_ledger").all();
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.kind, "daily");
  assert.equal(entry.prev_hash, GENESIS);
  assert.equal(entry.hash, sha(GENESIS + "|" + entry.record));
  assert.equal(entry.game_no, dailyNo());
  const rec = JSON.parse(entry.record);
  assert.deepEqual(Object.keys(rec).sort(), ["daily", "day", "hands", "moves", "place", "player", "totals"]);   // never the moves or the seed themselves
  assert.equal(rec.daily, dailyNo());
  assert.equal(rec.day, today());
  assert.equal(rec.moves, sha(game.actions));
  assert.equal(rec.totals[0], game.final);
  assert.equal(rec.hands, t.view.history.length);
  assert.deepEqual(rec.totals, t.view.totals);
  assert.equal(rec.player, entry.player_id);
  assert.equal(t.hash, entry.hash);
  assert.ok(t.view.history.length >= 2);   // a game to 11 takes several hands
  const deal = raw.prepare("SELECT * FROM pitch_daily_deals WHERE n = ?").get(dailyNo());
  assert.equal(deal.games, 1);
  assert.equal(deal.hands, t.view.history.length);
  assert.equal(deal["place_" + rec.place], 1);
  assert.equal(deal.place_1 + deal.place_2 + deal.place_3 + deal.place_4, 1);
  assert.deepEqual(t.field, { games: 1, hands: deal.hands, places: [deal.place_1, deal.place_2, deal.place_3, deal.place_4] });
  assert.deepEqual(t.next, { kind: "game", n: 1 });   // the Daily game is done: numbered game 1 is next
  // a sealed game takes no more moves, and reloading shows it finished
  const again = await call("/api/act", { body: mv(t, { type: "bid", bid: 0 }), cookie });
  assert.equal(again.status, 409);
  const reload = await call("/api/game", { cookie });
  assert.equal(reload.game, dailyNo());
  assert.equal(reload.view.over, true);
  assert.deepEqual(reload.view.totals, t.view.totals);
  assert.deepEqual(reload.view.history, t.view.history);
  // a Daily game seals once: the ledger refuses a second one for the same player and day
  assert.throws(() => raw.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at, game_no) VALUES ('daily', ?, ?, '{}', 'p2', 'h2', 1, ?)").run(today(), entry.player_id, dailyNo()));
});

test("a game still being played carries on across hands and reloads", async () => {
  const { call } = setup();
  let t = await call("/api/game"), c = null, handsDone = 0;
  while (!t.view.over && handsDone < 1) {
    const r = await call("/api/act", { body: mv(t, first(t.view)), cookie: c });
    assert.equal(r.status, 200, r.error);
    c = r.cookie || c; t = r; handsDone = t.view.history.length;
  }
  assert.equal(t.view.over, false);
  assert.equal(t.view.no, 1);   // the second hand is being played
  assert.equal(t.view.history.length, 1);
  const reload = await call("/api/game", { cookie: c });
  assert.equal(reload.n, t.n);
  assert.deepEqual(reload.view.totals, t.view.totals);
});

test("play: today's Daily game first, then the numbered games one at a time, with the same deal for every player", async () => {
  const { call, raw } = setup();
  assert.equal((await call("/api/play", { body: {} })).status, 401);   // no player yet: you start by moving
  const start1 = await call("/api/game");   // today's Daily game
  const { t: d, cookie } = await playThrough(call);
  assert.equal(d.daily, true);
  const p = await call("/api/play", { body: {}, cookie });
  assert.equal(p.status, 200, p.error);
  assert.equal(p.game, 1);
  assert.equal(p.daily, false);
  assert.equal(p.n, 0);
  assert.equal(p.view.over, false);
  assert.deepEqual(p.view.hand, viewGame(startGame(seedOf(raw, 1), JSON.parse(raw.prepare("SELECT memory FROM pitch_deals WHERE n = 1").get().memory))).hand);
  assert.notDeepEqual(p.view.hand, start1.view.hand);   // game 1 is not the Daily game
  assert.equal((await call("/api/game", { cookie })).game, 1);   // a reload lands on it
  assert.equal((await call("/api/play", { body: {}, cookie })).game, 1);   // one at a time: it gives the open one back
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_games").get().n, 1);
  // a move for the game you just finished is refused, and says what you are on
  const old = await call("/api/act", { body: mv(d, first(p.view)), cookie });
  assert.equal(old.status, 409);
  assert.equal(old.game, 1);
  // finishing it seals result number 1 for the same player, and the next game is number 2 (the Daily game is once a day)
  const { t: g1 } = await playThrough(call, cookie);
  assert.equal(g1.game, 1);
  assert.deepEqual(g1.next, { kind: "game", n: 2 });
  assert.deepEqual(raw.prepare("SELECT kind, game_no FROM pitch_ledger ORDER BY id").all().map((e) => [e.kind, e.game_no]), [["daily", dailyNo()], ["result", 1]]);
  assert.equal(raw.prepare("SELECT games FROM pitch_deals WHERE n = 1").get().games, 1);
  assert.equal((await call("/api/play", { body: {}, cookie })).game, 2);
  // another player starts at today's Daily game and holds the same cards and table
  const fresh = await call("/api/game", { ip: "7.7.7.7" });
  assert.deepEqual(fresh.view.hand, start1.view.hand);
  assert.deepEqual(fresh.view.cast, start1.view.cast);
  const other = await call("/api/act", { body: mv(fresh, first(fresh.view)), ip: "7.7.7.7" });
  assert.equal(other.status, 200);
  assert.equal(other.game, dailyNo());
});

test("a game in progress is finished first, then the player is forced into today's Daily game, then the numbered games go on", async () => {
  const { call, raw } = setup();
  const token = "t".repeat(32);
  raw.prepare("INSERT INTO pitch_players (token_hash, created_at) VALUES (?, 1)").run(sha(token));
  const cookie = "np=" + token, id = raw.prepare("SELECT id FROM pitch_players").get().id;
  raw.prepare("INSERT INTO pitch_games (player_id, n, actions, done, created_at, updated_at) VALUES (?, 14, '[]', 0, 1, 1)").run(id);
  const t = await call("/api/game", { cookie });
  assert.equal(t.game, 14);   // not interrupted by the Daily game
  assert.equal(t.daily, false);
  const { t: done } = await playThrough(call, cookie);
  assert.equal(done.game, 14);
  assert.deepEqual(done.next, { kind: "daily", n: dailyNo() });
  const d = await call("/api/play", { body: {}, cookie });
  assert.equal(d.daily, true);
  assert.equal(d.game, dailyNo());
  const { t: dd } = await playThrough(call, cookie);
  assert.deepEqual(dd.next, { kind: "game", n: 15 });   // "game #14, Daily game #N, game #15"
  assert.equal((await call("/api/play", { body: {}, cookie })).game, 15);
  // an earlier day's Daily game left unfinished is still theirs to finish
  raw.prepare("DELETE FROM pitch_daily_games").run();
  raw.prepare("DELETE FROM pitch_games WHERE n = 15").run();
  raw.prepare("INSERT INTO pitch_daily_games (player_id, n, actions, done, created_at, updated_at) VALUES (?, ?, '[]', 0, 1, 1)").run(id, dailyNo() - 1);
  assert.equal((await call("/api/game", { cookie })).game, dailyNo() - 1);   // yesterday's unfinished Daily game is still theirs to finish
});

test("a saved game whose moves no longer replay (the bots changed) starts over instead of breaking", async () => {
  const { call, raw } = setup();
  const t = await call("/api/game");
  const r = await call("/api/act", { body: mv(t, first(t.view)) });
  // moves that can't be legal for this deal, as if saved under other bot rules
  raw.prepare("UPDATE pitch_daily_games SET actions = ?").run(JSON.stringify([{ type: "bid", bid: 0 }, { type: "play", card: 0 }, { type: "play", card: 1 }, { type: "play", card: 2 }]));
  const back = await call("/api/game", { cookie: r.cookie });
  assert.equal(back.status, 200);
  assert.equal(back.reset, true);
  assert.equal(back.n, 0);
  assert.equal(raw.prepare("SELECT actions FROM pitch_daily_games").get().actions, "[]");
  assert.equal((await call("/api/game", { cookie: r.cookie })).reset, undefined);   // only said once
  const again = await call("/api/act", { body: mv(t, first(t.view)), cookie: r.cookie });
  assert.equal(again.status, 200);
  // a finished game that can't replay can't be shown, so the next game comes up instead
  raw.prepare("UPDATE pitch_daily_games SET actions = ?, done = 1").run(JSON.stringify([{ type: "bid", bid: 0 }, { type: "play", card: 0 }]));
  const next = await call("/api/game", { cookie: r.cookie });
  assert.equal(next.game, 1);
  assert.equal(next.daily, false);
  assert.equal(next.n, 0);
  assert.equal((await call("/api/act", { body: mv(next, first(next.view)), cookie: r.cookie })).status, 200);
});

test("the table's memory: a game starts from a snapshot taken when it was first asked for, and sealed games add to the counts", async () => {
  const { call, raw } = setup();
  raw.prepare("INSERT INTO pitch_crowd_counts (k, bid, n) VALUES ('2-3-0', 2, 9), ('2-3-0', 0, 1)").run();   // earlier players
  await call("/api/game");
  const snap = raw.prepare("SELECT memory FROM pitch_daily_deals WHERE n = ?").get(dailyNo()).memory;
  assert.deepEqual(JSON.parse(snap), { "2-3-0": { 0: 1, 2: 9 } });
  // a whole game adds its bids to the counts, but today's snapshot (and so today's bots) stays as it was, for the next player too
  const before = raw.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM pitch_crowd_counts").get().n;
  const { t, cookie } = await playThrough(call);
  const after = raw.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM pitch_crowd_counts").get().n;
  const chosen = t.view.history.filter((h) => h.crowd).length;   // a forced 2 as dealer isn't a choice
  assert.equal(after - before, chosen);
  assert.ok(chosen >= 1);
  assert.equal(raw.prepare("SELECT memory FROM pitch_daily_deals WHERE n = ?").get(dailyNo()).memory, snap);
  const second = await call("/api/game", { ip: "8.8.8.8" });
  assert.deepEqual(second.view.cast, t.view.cast);
  // game 1 is first asked for now, so it starts from the counts as they stand now
  await call("/api/play", { body: {}, cookie });
  const snap1 = JSON.parse(raw.prepare("SELECT memory FROM pitch_deals WHERE n = 1").get().memory);
  assert.equal(Object.values(snap1).reduce((a, m) => a + Object.values(m).reduce((x, y) => x + y, 0), 0), after);
});

test("every seal sends the registry a checkpoint: the entry count, the newest hash and the game's public facts", async () => {
  const { call, raw, checkpoints } = setup();
  await call("/api/game");   // looking seals nothing
  assert.equal(checkpoints.length, 0);
  const { t: d, cookie } = await playThrough(call);   // seals the Daily game
  const one = raw.prepare("SELECT id, hash FROM pitch_ledger ORDER BY id DESC LIMIT 1").get();
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(Object.keys(checkpoints[0]).sort(), ["detail", "entries", "game", "head"]);
  assert.equal(checkpoints[0].game, "nano-pitch");
  assert.equal(checkpoints[0].entries, one.id);
  assert.equal(checkpoints[0].head, one.hash);
  const hist = d.view.history;
  assert.deepEqual(checkpoints[0].detail, {
    kind: "daily", game: dailyNo(), day: today(), hands: hist.length, place: d.view.place, score: d.view.totals[0], top: Math.max(...d.view.totals),
    pitched: hist.filter((h) => h.pitcher === 0).length, made: hist.filter((h) => h.pitcher === 0 && h.made).length,
    bids: hist.map((h) => h.bids.find((b) => b.seat === 0).bid), trumps: hist.map((h) => "CDHS"[h.trump]),
    pitchers: hist.map((h) => h.pitcher),
  });
  await call("/api/game", { cookie });   // nothing new sealed: no checkpoint
  assert.equal(checkpoints.length, 1);
  await call("/api/play", { body: {}, cookie });
  await playThrough(call, cookie);   // seals game 1
  const two = raw.prepare("SELECT id, hash FROM pitch_ledger ORDER BY id DESC LIMIT 1").get();
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[1].entries, two.id);
  assert.equal(checkpoints[1].head, two.hash);
  assert.equal(checkpoints[1].detail.kind, "game");
  assert.equal(checkpoints[1].detail.game, 1);
  assert.equal("day" in checkpoints[1].detail, false);
});

test("a move from a stale tab, an illegal move and another game are refused", async () => {
  const { call } = setup();
  const t = await call("/api/game");
  const r1 = await call("/api/act", { body: mv(t, first(t.view)) });
  assert.equal(r1.status, 200);
  const stale = await call("/api/act", { body: mv(t, first(t.view)), cookie: r1.cookie });
  assert.equal(stale.status, 409);
  assert.equal(stale.n, 1);   // the answer carries the game as it really is
  const bad = await call("/api/act", { body: { ...mv(t, { type: "bid", bid: 7 }), n: 1 }, cookie: r1.cookie });
  assert.equal(bad.status, 400);
  const other = await call("/api/act", { body: { ...mv(t, first(t.view)), n: 1, game: 1, daily: false }, cookie: r1.cookie });   // numbered game 1, not today's Daily game
  assert.equal(other.status, 409);
  assert.equal(other.game, t.game);
  assert.equal(other.daily, true);
});

test("the ledger shows results to everyone, and hides today's entries from before numbered games", async () => {
  const { call, raw } = setup();
  await playThrough(call);
  raw.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at) VALUES ('day', '2000-01-01', NULL, '{}', 'p-old', 'h-old', 1)").run();
  raw.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at) VALUES ('game', ?, 1, '{\"actions\":[]}', 'p-g', 'h-g', 1)").run(today());
  raw.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at) VALUES ('day', ?, NULL, '{}', 'p-d', 'h-d', 1)").run(today());
  const l = await call("/api/ledger");
  const result = l.entries.find((e) => e.kind === "daily");
  assert.ok(result.record && JSON.parse(result.record).daily === dailyNo());   // a Daily game's entry is public the day it is sealed
  assert.equal(l.entries.find((e) => e.kind === "game").record, null);   // an old game from today stays hidden
  const old = l.entries.find((e) => e.day === "2000-01-01");
  assert.equal(old.seed, dailySeedOf(raw, "2000-01-01"));   // a past day's seed is still shown
  const todays = l.entries.find((e) => e.kind === "day" && e.day === today());
  assert.equal("seed" in todays, false);
});

test("the ledger shows a finished game's player name, the table's names and the field, and plain=1 leaves them out", async () => {
  const { call, raw } = setup();
  const { cookie } = await playThrough(call);
  const entry = raw.prepare("SELECT * FROM pitch_ledger").get();
  let l = await call("/api/ledger");
  assert.equal(l.entries[0].name, null);   // no name yet: the page says "Player N"
  raw.prepare("UPDATE pitch_players SET name = 'Test Name', pfp = '🐸' WHERE id = ?").run(entry.player_id);
  l = await call("/api/ledger");
  const e = l.entries[0];
  assert.equal(e.record, entry.record);   // the sealed record is untouched
  assert.equal(e.hash, entry.hash);
  assert.equal(e.name, "Test Name");
  assert.equal(e.pfp, "🐸");
  assert.deepEqual(e.table.map((c) => c.name), castOf(dailySeedOf(raw, today())).slice(1).map((c) => c.name));   // the same three the game seated
  const deal = raw.prepare("SELECT * FROM pitch_daily_deals").get();
  assert.deepEqual(e.field, { games: 1, hands: deal.hands, places: [deal.place_1, deal.place_2, deal.place_3, deal.place_4] });
  const plain = (await call("/api/ledger?plain=1")).entries[0];
  assert.equal(plain.record, entry.record);
  assert.equal("name" in plain, false);
  assert.equal("table" in plain, false);
  assert.ok(cookie);
});

test("a guest is shown a signed name that stays in their browser; a save code makes it theirs; a made-up one isn't", async () => {
  const { call, raw } = setup();
  const t = await call("/api/game");
  assert.match(t.you.name, /^[A-Z][a-z]+ [A-Za-z]+$/);
  assert.equal(t.you.sig, createHmac("sha256", secretOf(raw)).update("preview:" + t.you.name).digest("hex"));   // signed with the server's secret
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_players").get().n, 0);   // looking makes no player
  const first1 = await call("/api/act", { body: { ...mv(t, first(t.view)), preview: t.you }, ip: "1.1.1.1" });   // even if the page sent it, a move stores no name
  assert.equal(first1.status, 200);
  const nameOf = (id) => raw.prepare("SELECT name FROM pitch_players WHERE id = ?").get(id).name;
  assert.equal(nameOf(1), null);
  assert.equal((await call("/api/account", { cookie: first1.cookie })).name, null);   // looking at the account gives a guest no name either
  assert.equal(nameOf(1), null);
  assert.ok((await call("/api/game", { cookie: first1.cookie })).you);   // a guest keeps being offered one to show
  const re = await call("/api/name", { body: {}, cookie: first1.cookie });   // a guest's reroll: a new signed name to show, nothing stored
  assert.equal(re.sig, createHmac("sha256", secretOf(raw)).update("preview:" + re.name).digest("hex"));
  assert.equal(nameOf(1), null);
  // a save code makes the name they were shown theirs
  assert.ok((await call("/api/codes", { body: { action: "new", preview: t.you }, cookie: first1.cookie })).code);
  assert.equal(nameOf(1), t.you.name);
  assert.equal((await call("/api/game", { cookie: first1.cookie })).you, undefined);   // named: no more offers
  // the same name again (taken now) gives another; a made-up name is ignored
  const second = await call("/api/act", { body: mv(t, first(t.view)), ip: "2.2.2.2" });
  await call("/api/codes", { body: { action: "new", preview: t.you }, cookie: second.cookie });
  assert.ok(nameOf(2) && nameOf(2) !== t.you.name);
  const third = await call("/api/act", { body: mv(t, first(t.view)), ip: "3.3.3.3" });
  await call("/api/codes", { body: { action: "new", preview: { name: "Typed Myself", sig: "0".repeat(64) } }, cookie: third.cookie });
  assert.ok(nameOf(3) && nameOf(3) !== "Typed Myself");
  // an account holder's reroll is stored
  const rr = await call("/api/name", { body: {}, cookie: first1.cookie });
  assert.equal(nameOf(1), rr.name);
  assert.equal(rr.sig, undefined);
});

test("new players: 3 an hour from one address", async () => {
  const { call } = setup();
  const t = await call("/api/game");
  for (let i = 0; i < 3; i++) assert.equal((await call("/api/act", { body: mv(t, first(t.view)) })).status, 200);
  assert.equal((await call("/api/act", { body: mv(t, first(t.view)) })).status, 429);
  assert.equal((await call("/api/act", { body: mv(t, first(t.view)), ip: "5.6.7.8" })).status, 200);
});

test("a save code brings the same player and game to another device", async () => {
  const { call } = setup();
  const t = await call("/api/game");
  const r = await call("/api/act", { body: mv(t, first(t.view)) });
  const code = (await call("/api/codes", { body: { action: "new" }, cookie: r.cookie })).code;
  assert.ok(code);
  const load = await call("/api/load", { body: { code }, ip: "9.9.9.9" });
  assert.equal(load.status, 200);
  const there = await call("/api/game", { cookie: load.cookie });
  assert.equal(there.n, 1);
  const acc = await call("/api/account", { cookie: load.cookie });
  assert.equal(acc.devices, 2);
});

test("every table, index and trigger is named pitch_, and the code only touches pitch_ tables", () => {
  const files = ["schema.sql", ...readdirSync(new URL("../migrations/", import.meta.url)).map((f) => "migrations/" + f)];
  for (const f of files) {
    const sql = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    const names = [...sql.matchAll(/(?:CREATE\s+(?:UNIQUE\s+)?|DROP\s+)(?:TABLE|INDEX|TRIGGER|VIEW)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1]);
    assert.ok(names.length > 0, f);
    for (const n of names) assert.match(n, /^pitch_/, `${f}: ${n}`);
  }
  for (const f of ["src/worker.js", "src/ledger.js"]) {
    const code = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    const used = [...code.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+(?!SET\b)([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
    assert.ok(used.length > 0, f);
    for (const n of used) assert.match(n, /^pitch_/, `${f}: ${n}`);
  }
});


test("usernames: a random name when the account is looked at, rerolled on request, unique ignoring case", async () => {
  const { call, raw } = setup();
  const t = await call("/api/game");
  const r0 = await call("/api/act", { body: mv(t, first(t.view)) });
  await call("/api/codes", { body: { action: "new" }, cookie: r0.cookie });   // a guest has no name on the server: a save code gives one
  const a = await call("/api/account", { cookie: r0.cookie });
  assert.match(a.name, /^[A-Z][A-Za-z]+ [A-Za-z]+$/);
  assert.equal((await call("/api/account", { cookie: r0.cookie })).name, a.name);   // it stays until rerolled
  assert.equal(raw.prepare("SELECT name_key FROM pitch_players WHERE id = ?").get(a.id).name_key, a.name.toLowerCase());
  const again = await call("/api/name", { body: {}, cookie: r0.cookie });
  assert.equal(again.status, 200);
  assert.notEqual(again.name, a.name);
  assert.equal((await call("/api/account", { cookie: r0.cookie })).name, again.name);
  assert.equal((await call("/api/name", { body: {} })).status, 401);   // no player, no name
  assert.equal((await call("/api/account", { cookie: r0.cookie })).pfp, null);   // no pic chosen yet: the page uses its default
  assert.equal((await call("/api/pfp", { body: { pfp: "🐸" }, cookie: r0.cookie })).pfp, "🐸");
  assert.equal((await call("/api/account", { cookie: r0.cookie })).pfp, "🐸");
  assert.equal((await call("/api/pfp", { body: { pfp: "<b>" }, cookie: r0.cookie })).status, 400);   // only the pool's emoji
  assert.equal((await call("/api/pfp", { body: { pfp: "🐸" } })).status, 401);
  assert.throws(() => raw.prepare("INSERT INTO pitch_players (token_hash, created_at, name, name_key) VALUES ('x', 1, 'A', ?)").run(again.name.toLowerCase()));   // taken
});

test("the migrations build the same tables as schema.sql", () => {
  const shape = (sql) => {
    const db = new DatabaseSync(":memory:");
    db.exec(sql);
    return db.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map((r) => ({ ...r, cols: r.type === "table" ? db.prepare(`PRAGMA table_info(${r.name})`).all().map((c) => [c.name, c.type, c.notnull, c.pk]) : null }));
  };
  const dir = new URL("../migrations/", import.meta.url);
  const migrations = readdirSync(dir).sort().map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
  assert.deepEqual(shape(migrations), shape(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")));
});

test("your hands: a finished game opens hand by hand for the player who finished it and for no one else", async () => {
  const { call } = setup();
  const t0 = await call("/api/game");
  const a = await call("/api/act", { body: mv(t0, first(t0.view)) });
  const { t, cookie } = await playThrough(call, a.cookie);
  const q = `/api/hands?daily=${t.daily ? 1 : 0}&n=${t.game}`;
  const mine = await call(q, { cookie });
  assert.equal(mine.status, 200);
  assert.equal(mine.hands.length, t.view.history.length);
  for (const [i, h] of mine.hands.entries()) {
    assert.equal(h.no, i);
    assert.ok(h.tricks.length >= 1 && h.tricks.every((x) => x.plays.length >= 1 && Number.isInteger(x.winner)));
    assert.ok(h.bids.length >= 4 && h.final.length === 4);
  }
  // the ledger marks only your own entry
  const led = await call("/api/ledger?limit=5", { cookie });
  assert.equal(led.entries.find((e) => e.kind === (t.daily ? "daily" : "result")).mine, true);
  const stranger = await call("/api/ledger?limit=5");
  assert.ok(stranger.entries.every((e) => !e.mine));
  // no one else can open it: nobody logged in, or another player
  assert.equal((await call(q)).status, 404);
  const other = await call("/api/game", { ip: "5.6.7.8" });
  const o = await call("/api/act", { body: mv(other, first(other.view)), ip: "5.6.7.8" });
  assert.equal((await call(q, { cookie: o.cookie, ip: "5.6.7.8" })).status, 404);
  // a game you haven't finished is refused too
  const next = await call("/api/play", { body: {}, cookie });
  assert.equal((await call(`/api/hands?daily=${next.daily ? 1 : 0}&n=${next.game}`, { cookie })).status, 404);
});

test("the carried copy: /api/game shows it; finishing a Daily marks it only on first place; the carry window and pinning", async () => {
  const { env, call, raw } = setup(), marked = [], pins = [], asked = [];
  Object.assign(env.REGISTRY, {
    async pinned() { return { itemId: 4, copy: 2, item: { name: "a lamp" }, marks: [] }; },
    async markCarried(m) { marked.push(m); return { ok: true, n: 1, created: true }; },
    async carryWindow(a) { asked.push(a); return "<p>window</p>"; },
    async pin(p) { pins.push(p); return { ok: true }; },
  });
  const { t: end, cookie } = await playThrough(call, null);
  assert.deepEqual((await call("/api/game", { cookie })).carry, { name: "a lamp", copy: 2, blessed: 0 });
  const id = raw.prepare("SELECT id FROM pitch_players").get().id;
  const place = JSON.parse(raw.prepare("SELECT record FROM pitch_ledger WHERE kind = 'daily'").get().record).place;
  assert.ok(end.daily);
  assert.deepEqual(marked, place === 1
    ? [{ itemId: 4, copy: 2, by: { game: "nano-pitch", playerId: id }, kind: "deed", value: "won_daily", key: "daily:" + end.game }] : []);
  const page = await worker.fetch(new Request("https://pitch.88x31.app/api/carry?embed=1", { headers: { cookie } }), env);
  assert.equal(await page.text(), "<p>window</p>");
  assert.deepEqual([asked[0].game, asked[0].playerId, asked[0].embed, asked[0].preview], ["nano-pitch", id, true, "np-preview"]);
  assert.equal((await call("/api/pin", { cookie, body: { itemId: 4, copy: 2 } })).status, 200);
  assert.deepEqual(pins, [{ game: "nano-pitch", playerId: id, itemId: 4, copy: 2 }]);
});

test("the BBS: a guest player per call with the accounts key (404 without), and its limits count per BBS user", async () => {
  const { env, call } = setup();
  env.ACCOUNTS_KEY = "k".repeat(24);
  const bbs = async (path, { body, user, key = env.ACCOUNTS_KEY, cookie } = {}) => {
    const r = await worker.fetch(new Request("https://pitch.88x31.app" + path, { method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9", "x-accounts-key": key, ...(user ? { "x-bbs-user": user } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil: () => {} });
    return { status: r.status, ...(await r.json()) };
  };
  assert.equal((await bbs("/api/bbs-enter", { body: {}, key: "wrong".repeat(5) })).status, 404);
  const a = await bbs("/api/bbs-enter", { body: {}, user: "4" }), b = await bbs("/api/bbs-enter", { body: {}, user: "5" });
  assert.match(a.token, /^[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(a.token, b.token);
  // the guest plays a move with its token: no new player is made (the cookie finds it)
  const t = await bbs("/api/game", { cookie: "np=" + a.token, user: "4" });
  const r = await bbs("/api/act", { body: mv(t, first(t.view)), cookie: "np=" + a.token, user: "4" });
  assert.equal(r.status, 200, r.error);
  // the new-guest limit (3 an hour) counts per BBS user: 4 users from one address can each make a player on their first move
  for (const user of ["11", "12", "13", "14"]) {
    const g = await bbs("/api/game", { user });
    assert.equal((await bbs("/api/act", { body: mv(g, first(g.view)), user })).status, 200);
  }
  // without the key they all count against the address: the 4th is refused
  const plain = [];
  for (let i = 0; i < 4; i++) { const g = await call("/api/game", { ip: "8.8.8.8" }); plain.push((await call("/api/act", { body: mv(g, first(g.view)), ip: "8.8.8.8" })).status); }
  assert.deepEqual(plain, [200, 200, 200, 429]);
});
