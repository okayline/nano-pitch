// The ledger: one SHA-256 hash chain, the same design as the other games' ledgers (copied from moba-beat src/ledger.js,
// with the table renamed pitch_ledger because it shares the moba-beat database).
//
//   hash = SHA-256( prev_hash + "|" + record )
//
// Two kinds of entry:
//   day   { day, seed_hash, memory_hash }: seed_hash is SHA-256 of the day's secret seed. It proves the deal was fixed before
//         anyone played; the seed itself is shown once the day is over, so anyone can rebuild the deal and check every hand.
//         memory_hash is SHA-256 of the table's memory of bids as it stood when the day began (pitch_crowd), which the bots
//         follow all day. (Entries from before v0.4 have no memory_hash.)
//   game  { day, player, actions, hands, totals, place }: a player's finished game: every bid and card they played, in order,
//         and the totals and place the server worked out by replaying them. Players are ids, never names. Hidden until the
//         day is over, because everyone holds the same cards. (Older entries of kind 'hand' are single hands.)
//
// The first entry chains from GENESIS. Changing any old record breaks its hash and every hash after it. prev_hash is
// UNIQUE, so the chain can't fork.

export const GENESIS = "0".repeat(64);

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function head(db) {
  const h = await db.prepare("SELECT hash FROM pitch_ledger ORDER BY id DESC LIMIT 1").first();
  return h ? h.hash : GENESIS;
}

// Two requests can read the same head at once; prev_hash UNIQUE lets only one of them build on it. The other is sealed
// again on the new head. Another UNIQUE clash (that day's entry, that player's game that day) means it's already there.
const chainClash = (e) => /UNIQUE/i.test(String(e && e.message)) && /pitch_ledger\.(prev_)?hash/.test(String(e.message));
const anyUnique = (e) => /UNIQUE/i.test(String(e && e.message));

// Seal on the current head. `build(prev)` gives { hash, stmts }: the ledger insert chained from prev and anything to go in
// the same D1 batch. Returns { hash }, or { duplicate: true }.
export async function seal(db, build) {
  for (let i = 0; i < 8; i++) {
    const { hash, stmts } = await build(await head(db));
    try { await db.batch(stmts); return { hash }; }
    catch (e) {
      if (chainClash(e)) continue;
      if (anyUnique(e)) return { duplicate: true };
      throw e;
    }
  }
  throw new Error("The ledger is busy. Try again.");
}

export async function entryInsert(db, prev, { kind, day, playerId = null, record, t }) {
  const hash = await sha256(prev + "|" + record);
  return { hash, stmt: db.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(kind, day, playerId, record, prev, hash, t) };
}

// The day's entry, sealing it first if it isn't on the chain yet: { hash, sealed }.
const dayRow = (db, day) => db.prepare("SELECT hash FROM pitch_ledger WHERE kind = 'day' AND day = ?").bind(day).first();
export async function dayEntry(db, day, seedHash, memoryHash, t) {
  const got = await dayRow(db, day);
  if (got) return { hash: got.hash, sealed: false };
  const record = JSON.stringify({ day, seed_hash: seedHash, memory_hash: memoryHash });
  const r = await seal(db, async (prev) => {
    const { hash, stmt } = await entryInsert(db, prev, { kind: "day", day, record, t });
    return { hash, stmts: [stmt] };
  });
  if (r.duplicate) return { hash: (await dayRow(db, day)).hash, sealed: false };
  return { hash: r.hash, sealed: true };
}
