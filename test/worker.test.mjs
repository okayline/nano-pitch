// The Worker against a D1 lookalike (Node's SQLite) and a stand-in for the shared Accounts. Expected values come from
// node:crypto and raw SQL, not from the code under test. The D1 and Accounts stand-ins are copied from moba-beat's tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";

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
  const env = { DB, ACCOUNTS: fakeAccounts() };
  const call = async (path, { body, cookie, ip = "1.2.3.4" } = {}) => {
    const r = await worker.fetch(new Request("https://pitch.88x31.app" + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env, { waitUntil() {} });
    const set = r.headers.get("set-cookie");
    return { status: r.status, cookie: set ? set.split(";")[0] : null, ...(await r.json()) };
  };
  return { env, call, raw: DB.raw };
}
const today = () => new Date().toISOString().slice(0, 10);

// Plays the first allowed bid and the first legal card until the hand is done. Returns the last answer.
async function playThrough(call, cookie) {
  let t = await call("/api/today", { cookie }), c = cookie;
  while (t.view.phase !== "done") {
    const v = t.view;
    const action = v.phase === "bid" ? { type: "bid", bid: v.bidOptions[0] } : { type: "play", card: v.legal[0] };
    const r = await call("/api/act", { body: { day: t.day, n: t.n, action }, cookie: c });
    assert.equal(r.status, 200, r.error);
    c = r.cookie || c;
    t = r;
  }
  return { t, cookie: c };
}

test("looking at today seals the day's entry with the seed's hash and makes no player", async () => {
  const { call, raw } = setup();
  const t = await call("/api/today");
  assert.equal(t.status, 200);
  assert.equal(t.cookie, null);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_players").get().n, 0);
  assert.equal(t.view.hand.length, 6);
  assert.equal("hands" in t.view, false);
  const secret = raw.prepare("SELECT value FROM pitch_meta WHERE key = 'secret'").get().value;
  assert.match(secret, /^[0-9a-f]{64}$/);
  const seed = createHmac("sha256", secret).update("daily:" + today()).digest("hex");
  const rec = JSON.stringify({ day: today(), seed_hash: sha(seed) });
  const e = raw.prepare("SELECT * FROM pitch_ledger").all();
  assert.equal(e.length, 1);
  assert.equal(e[0].record, rec);
  assert.equal(e[0].hash, sha(GENESIS + "|" + rec));
  await call("/api/today");   // a second look seals nothing more
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pitch_ledger").get().n, 1);
});

test("a whole hand: saved move by move, sealed once on the ledger, added to the field", async () => {
  const { call, raw } = setup();
  const { t, cookie } = await playThrough(call);
  assert.ok(cookie);
  const hand = raw.prepare("SELECT * FROM pitch_hands").get();
  assert.equal(hand.done, 1);
  const entry = raw.prepare("SELECT * FROM pitch_ledger WHERE kind = 'hand'").get();
  const prev = raw.prepare("SELECT hash FROM pitch_ledger WHERE kind = 'day'").get().hash;
  assert.equal(entry.prev_hash, prev);
  assert.equal(entry.hash, sha(prev + "|" + entry.record));
  const rec = JSON.parse(entry.record);
  assert.deepEqual(rec.actions, JSON.parse(hand.actions));
  assert.equal(rec.final, hand.final);
  assert.equal(rec.player, entry.player_id);
  assert.equal(t.hash, entry.hash);
  // the field: one hand, counted under its score and its bid
  const col = { "-4": "s_m4", "-3": "s_m3", "-2": "s_m2", "-1": "s_m1", 0: "s_0", 1: "s_p1", 2: "s_p2", 3: "s_p3", 4: "s_p4" }[hand.final];
  const day = raw.prepare("SELECT * FROM pitch_days").get();
  assert.equal(day.hands, 1);
  assert.equal(day[col], 1);
  assert.equal(day.b_0 + day.b_2 + day.b_3 + day.b_4, 1);
  assert.equal(t.field.hands, 1);
  // a sealed hand takes no more moves, and reloading shows it finished
  const again = await call("/api/act", { body: { day: t.day, n: t.n, action: { type: "bid", bid: 0 } }, cookie });
  assert.equal(again.status, 409);
  const reload = await call("/api/today", { cookie });
  assert.equal(reload.view.phase, "done");
  assert.deepEqual(reload.view.result, t.view.result);
});

test("a move from a stale tab, an illegal move and another day are refused", async () => {
  const { call } = setup();
  const t = await call("/api/today");
  const first = t.view.phase === "bid" ? { type: "bid", bid: t.view.bidOptions[0] } : { type: "play", card: t.view.legal[0] };
  const r1 = await call("/api/act", { body: { day: t.day, n: 0, action: first } });
  assert.equal(r1.status, 200);
  const stale = await call("/api/act", { body: { day: t.day, n: 0, action: first }, cookie: r1.cookie });
  assert.equal(stale.status, 409);
  assert.equal(stale.n, 1);   // the answer carries the hand as it really is
  const bad = await call("/api/act", { body: { day: t.day, n: 1, action: { type: "bid", bid: 7 } }, cookie: r1.cookie });
  assert.equal(bad.status, 400);
  const old = await call("/api/act", { body: { day: "2000-01-01", n: 1, action: first }, cookie: r1.cookie });
  assert.equal(old.status, 409);
});

test("the ledger hides today's hands and shows a past day's seed", async () => {
  const { call, raw } = setup();
  await playThrough(call);
  await call("/api/today");
  raw.prepare("INSERT INTO pitch_ledger (kind, day, record, prev_hash, hash, created_at) VALUES ('day', '2000-01-01', '{}', 'p-old', 'h-old', 1)").run();
  const l = await call("/api/ledger");
  const hand = l.entries.find((e) => e.kind === "hand");
  assert.equal(hand.record, null);
  const secret = raw.prepare("SELECT value FROM pitch_meta WHERE key = 'secret'").get().value;
  const old = l.entries.find((e) => e.day === "2000-01-01");
  assert.equal(old.seed, createHmac("sha256", secret).update("daily:2000-01-01").digest("hex"));
  const todays = l.entries.find((e) => e.kind === "day" && e.day === today());
  assert.equal("seed" in todays, false);
});

test("new players: 3 an hour from one address", async () => {
  const { call } = setup();
  const t = await call("/api/today");
  const first = t.view.phase === "bid" ? { type: "bid", bid: t.view.bidOptions[0] } : { type: "play", card: t.view.legal[0] };
  for (let i = 0; i < 3; i++) assert.equal((await call("/api/act", { body: { day: t.day, n: 0, action: first } })).status, 200);
  assert.equal((await call("/api/act", { body: { day: t.day, n: 0, action: first } })).status, 429);
  assert.equal((await call("/api/act", { body: { day: t.day, n: 0, action: first }, ip: "5.6.7.8" })).status, 200);
});

test("a save code brings the same player and hand to another device", async () => {
  const { call } = setup();
  const t = await call("/api/today");
  const first = t.view.phase === "bid" ? { type: "bid", bid: t.view.bidOptions[0] } : { type: "play", card: t.view.legal[0] };
  const r = await call("/api/act", { body: { day: t.day, n: 0, action: first } });
  const code = (await call("/api/codes", { body: { action: "new" }, cookie: r.cookie })).code;
  assert.ok(code);
  const load = await call("/api/load", { body: { code }, ip: "9.9.9.9" });
  assert.equal(load.status, 200);
  const there = await call("/api/today", { cookie: load.cookie });
  assert.equal(there.n, 1);
  const acc = await call("/api/account", { cookie: load.cookie });
  assert.equal(acc.devices, 2);
});

test("every table, index and trigger is named pitch_, and the code only touches pitch_ tables", () => {
  const files = ["schema.sql", ...readdirSync(new URL("../migrations/", import.meta.url)).map((f) => "migrations/" + f)];
  for (const f of files) {
    const sql = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    const names = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1]);
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
