// The Worker against a D1 lookalike (Node's SQLite) and a stand-in for the shared Accounts. Expected values come from
// node:crypto and raw SQL, not from the code under test. The D1 and Accounts stand-ins are copied from moba-beat's tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";
import { startGame, viewGame } from "../public/engine/pitch.js";

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

// Plays the first allowed bid and the first legal card until the current game is over. Returns the last answer.
async function playThrough(call, cookie) {
  let t = await call("/api/game", { cookie }), c = cookie;
  while (!t.view.over) {
    const r = await call("/api/act", { body: { game: t.game, n: t.n, action: first(t.view) }, cookie: c });
    assert.equal(r.status, 200, r.error);
    c = r.cookie || c;
    t = r;
  }
  return { t, cookie: c };
}

test("looking at game 1 makes no player and no ledger entry, and its deal is the seed from the number", async () => {
  const { call, raw } = setup();
  const t = await call("/api/game");
  assert.equal(t.status, 200);
  assert.equal(t.cookie, null);
  assert.equal(t.game, 1);
  assert.equal(t.n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_players").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_ledger").get().n, 0);
  assert.equal(t.view.hand.length, 6);
  assert.equal("hands" in t.view, false);
  assert.match(secretOf(raw), /^[0-9a-f]{64}$/);
  assert.deepEqual(t.view.hand, viewGame(startGame(seedOf(raw, 1), {})).hand);   // the same deal anyone gets for game 1 (no counts yet: an empty memory)
  const deal = raw.prepare("SELECT * FROM pitch_deals").all();
  assert.equal(deal.length, 1);
  assert.equal(deal[0].n, 1);
  assert.equal(deal[0].memory, "{}");
  await call("/api/game");   // a second look makes nothing more
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_deals").get().n, 1);
});

test("a whole game: saved move by move, sealed once on the ledger without its cards, added to the field", async () => {
  const { call, raw } = setup();
  const { t, cookie } = await playThrough(call);
  assert.ok(cookie);
  const game = raw.prepare("SELECT * FROM pitch_games").get();
  assert.equal(game.done, 1);
  assert.equal(game.n, 1);
  const entries = raw.prepare("SELECT * FROM pitch_ledger").all();
  assert.equal(entries.length, 1);   // no deal entries: only the finished game
  const entry = entries[0];
  assert.equal(entry.kind, "result");
  assert.equal(entry.prev_hash, GENESIS);
  assert.equal(entry.hash, sha(GENESIS + "|" + entry.record));
  assert.equal(entry.game_no, 1);
  const rec = JSON.parse(entry.record);
  assert.deepEqual(Object.keys(rec).sort(), ["game", "hands", "moves", "place", "player", "totals"]);   // never the moves or the seed themselves
  assert.equal(rec.game, 1);
  assert.equal(rec.moves, sha(game.actions));
  assert.equal(rec.totals[0], game.final);
  assert.equal(rec.hands, t.view.history.length);
  assert.deepEqual(rec.totals, t.view.totals);
  assert.equal(rec.player, entry.player_id);
  assert.equal(t.hash, entry.hash);
  assert.ok(t.view.history.length >= 2);   // a game to 11 takes several hands
  // the field: one game, counted under its place
  const deal = raw.prepare("SELECT * FROM pitch_deals WHERE n = 1").get();
  assert.equal(deal.games, 1);
  assert.equal(deal.hands, t.view.history.length);
  assert.equal(deal["place_" + rec.place], 1);
  assert.equal(deal.place_1 + deal.place_2 + deal.place_3 + deal.place_4, 1);
  assert.deepEqual(t.field, { games: 1, hands: deal.hands, places: [deal.place_1, deal.place_2, deal.place_3, deal.place_4] });
  // a sealed game takes no more moves, and reloading shows it finished
  const again = await call("/api/act", { body: { game: t.game, n: t.n, action: { type: "bid", bid: 0 } }, cookie });
  assert.equal(again.status, 409);
  const reload = await call("/api/game", { cookie });
  assert.equal(reload.game, 1);
  assert.equal(reload.view.over, true);
  assert.deepEqual(reload.view.totals, t.view.totals);
  assert.deepEqual(reload.view.history, t.view.history);
  // a game seals once: the ledger refuses a second result for the same player and game
  assert.throws(() => raw.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at, game_no) VALUES ('result', ?, ?, '{}', 'p2', 'h2', 1, 1)").run(today(), entry.player_id));
});

test("a game still being played carries on across hands and reloads", async () => {
  const { call } = setup();
  let t = await call("/api/game"), c = null, handsDone = 0;
  while (!t.view.over && handsDone < 1) {
    const r = await call("/api/act", { body: { game: t.game, n: t.n, action: first(t.view) }, cookie: c });
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

test("play: the next game in the sequence, one at a time, with the same deal for every player", async () => {
  const { call, raw } = setup();
  assert.equal((await call("/api/play", { body: {} })).status, 401);   // no player yet: you start by moving
  const start1 = await call("/api/game");
  const { t: g1, cookie } = await playThrough(call);
  const p = await call("/api/play", { body: {}, cookie });
  assert.equal(p.status, 200, p.error);
  assert.equal(p.game, 2);
  assert.equal(p.n, 0);
  assert.equal(p.view.over, false);
  assert.deepEqual(p.view.hand, viewGame(startGame(seedOf(raw, 2), JSON.parse(raw.prepare("SELECT memory FROM pitch_deals WHERE n = 2").get().memory))).hand);
  assert.notDeepEqual(p.view.hand, start1.view.hand);   // game 2 is not game 1
  assert.equal((await call("/api/game", { cookie })).game, 2);   // a reload lands on it
  assert.equal((await call("/api/play", { body: {}, cookie })).game, 2);   // one at a time: it gives the open one back
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_games").get().n, 2);
  // a move for the game you just finished is refused, and says what you are on
  const old = await call("/api/act", { body: { game: 1, n: 0, action: first(p.view) }, cookie });
  assert.equal(old.status, 409);
  assert.equal(old.game, 2);
  // finishing it seals result number 2 for the same player
  const { t: g2 } = await playThrough(call, cookie);
  assert.equal(g2.game, 2);
  assert.deepEqual(raw.prepare("SELECT game_no FROM pitch_ledger WHERE kind = 'result' ORDER BY id").all().map((e) => e.game_no), [1, 2]);
  assert.equal(raw.prepare("SELECT games FROM pitch_deals WHERE n = 2").get().games, 1);
  // another player starts at game 1 and holds the same cards
  const fresh = await call("/api/game", { ip: "7.7.7.7" });
  assert.deepEqual(fresh.view.hand, start1.view.hand);
  assert.deepEqual(fresh.view.cast, start1.view.cast);   // the same table too
  const other = await call("/api/act", { body: { game: 1, n: 0, action: first(fresh.view) }, ip: "7.7.7.7" });
  assert.equal(other.status, 200);
  assert.equal(other.game, 1);
});

test("a saved game whose moves no longer replay (the bots changed) starts over instead of breaking", async () => {
  const { call, raw } = setup();
  const t = await call("/api/game");
  const r = await call("/api/act", { body: { game: 1, n: 0, action: first(t.view) } });
  // moves that can't be legal for this deal, as if saved under other bot rules
  raw.prepare("UPDATE pitch_games SET actions = ?").run(JSON.stringify([{ type: "bid", bid: 0 }, { type: "play", card: 0 }, { type: "play", card: 1 }, { type: "play", card: 2 }]));
  const back = await call("/api/game", { cookie: r.cookie });
  assert.equal(back.status, 200);
  assert.equal(back.reset, true);
  assert.equal(back.n, 0);
  assert.equal(raw.prepare("SELECT actions FROM pitch_games").get().actions, "[]");
  assert.equal((await call("/api/game", { cookie: r.cookie })).reset, undefined);   // only said once
  const again = await call("/api/act", { body: { game: 1, n: 0, action: first(t.view) }, cookie: r.cookie });
  assert.equal(again.status, 200);
  // a finished game that can't replay can't be shown, so the next game comes up instead
  raw.prepare("UPDATE pitch_games SET actions = ?, done = 1").run(JSON.stringify([{ type: "bid", bid: 0 }, { type: "play", card: 0 }]));
  const next = await call("/api/game", { cookie: r.cookie });
  assert.equal(next.game, 2);
  assert.equal(next.n, 0);
  assert.equal((await call("/api/act", { body: { game: 2, n: 0, action: first(next.view) }, cookie: r.cookie })).status, 200);
});

test("the table's memory: a game starts from a snapshot taken when it was first asked for, and sealed games add to the counts", async () => {
  const { call, raw } = setup();
  raw.prepare("INSERT INTO pitch_crowd_counts (k, bid, n) VALUES ('2-3-0', 2, 9), ('2-3-0', 0, 1)").run();   // earlier players
  await call("/api/game");
  const snap = raw.prepare("SELECT memory FROM pitch_deals WHERE n = 1").get().memory;
  assert.deepEqual(JSON.parse(snap), { "2-3-0": { 0: 1, 2: 9 } });
  // a whole game adds its bids to the counts, but game 1's snapshot (and so its bots) stays as it was
  const before = raw.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM pitch_crowd_counts").get().n;
  const { t, cookie } = await playThrough(call);
  const after = raw.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM pitch_crowd_counts").get().n;
  const chosen = t.view.history.filter((h) => h.crowd).length;   // a forced 2 as dealer isn't a choice
  assert.equal(after - before, chosen);
  assert.ok(chosen >= 1);
  assert.equal(raw.prepare("SELECT memory FROM pitch_deals WHERE n = 1").get().memory, snap);
  // game 2 is first asked for now, so it starts from the counts as they stand now
  await call("/api/play", { body: {}, cookie });
  const snap2 = JSON.parse(raw.prepare("SELECT memory FROM pitch_deals WHERE n = 2").get().memory);
  assert.equal(Object.values(snap2).reduce((a, m) => a + Object.values(m).reduce((x, y) => x + y, 0), 0), after);
});

test("every seal sends the registry a checkpoint: the entry count and the newest hash", async () => {
  const { call, raw, checkpoints } = setup();
  await call("/api/game");   // looking seals nothing
  assert.equal(checkpoints.length, 0);
  const { cookie } = await playThrough(call);   // seals a game
  const one = raw.prepare("SELECT id, hash FROM pitch_ledger ORDER BY id DESC LIMIT 1").get();
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(checkpoints[0], { game: "nano-pitch", entries: one.id, head: one.hash });
  await call("/api/game", { cookie });   // nothing new sealed: no checkpoint
  assert.equal(checkpoints.length, 1);
  await call("/api/play", { body: {}, cookie });
  await playThrough(call, cookie);   // seals the next
  const two = raw.prepare("SELECT id, hash FROM pitch_ledger ORDER BY id DESC LIMIT 1").get();
  assert.equal(checkpoints.length, 2);
  assert.deepEqual(checkpoints[1], { game: "nano-pitch", entries: two.id, head: two.hash });
});

test("a move from a stale tab, an illegal move and another game are refused", async () => {
  const { call } = setup();
  const t = await call("/api/game");
  const r1 = await call("/api/act", { body: { game: 1, n: 0, action: first(t.view) } });
  assert.equal(r1.status, 200);
  const stale = await call("/api/act", { body: { game: 1, n: 0, action: first(t.view) }, cookie: r1.cookie });
  assert.equal(stale.status, 409);
  assert.equal(stale.n, 1);   // the answer carries the game as it really is
  const bad = await call("/api/act", { body: { game: 1, n: 1, action: { type: "bid", bid: 7 } }, cookie: r1.cookie });
  assert.equal(bad.status, 400);
  const other = await call("/api/act", { body: { game: 5, n: 1, action: first(t.view) }, cookie: r1.cookie });
  assert.equal(other.status, 409);
  assert.equal(other.game, 1);
});

test("the ledger shows results to everyone, and hides today's entries from before numbered games", async () => {
  const { call, raw } = setup();
  await playThrough(call);
  raw.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at) VALUES ('day', '2000-01-01', NULL, '{}', 'p-old', 'h-old', 1)").run();
  raw.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at) VALUES ('game', ?, 1, '{\"actions\":[]}', 'p-g', 'h-g', 1)").run(today());
  raw.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at) VALUES ('day', ?, NULL, '{}', 'p-d', 'h-d', 1)").run(today());
  const l = await call("/api/ledger");
  const result = l.entries.find((e) => e.kind === "result");
  assert.ok(result.record && JSON.parse(result.record).game === 1);   // a result is public the day it is sealed
  assert.equal(l.entries.find((e) => e.kind === "game").record, null);   // an old game from today stays hidden
  const old = l.entries.find((e) => e.day === "2000-01-01");
  assert.equal(old.seed, createHmac("sha256", secretOf(raw)).update("daily:2000-01-01").digest("hex"));   // a past day's seed is still shown
  const todays = l.entries.find((e) => e.kind === "day" && e.day === today());
  assert.equal("seed" in todays, false);
});

test("new players: 3 an hour from one address", async () => {
  const { call } = setup();
  const t = await call("/api/game");
  for (let i = 0; i < 3; i++) assert.equal((await call("/api/act", { body: { game: 1, n: 0, action: first(t.view) } })).status, 200);
  assert.equal((await call("/api/act", { body: { game: 1, n: 0, action: first(t.view) } })).status, 429);
  assert.equal((await call("/api/act", { body: { game: 1, n: 0, action: first(t.view) }, ip: "5.6.7.8" })).status, 200);
});

test("a save code brings the same player and game to another device", async () => {
  const { call } = setup();
  const t = await call("/api/game");
  const r = await call("/api/act", { body: { game: 1, n: 0, action: first(t.view) } });
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
  const r0 = await call("/api/act", { body: { game: 1, n: 0, action: first(t.view) } });
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
