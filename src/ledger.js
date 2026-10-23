// The ledger: one SHA-256 hash chain, the same design as the other games' ledgers (copied from moba-beat src/ledger.js,
// with the table renamed pitch_ledger because it shares the moba-beat database).
//
//   hash = SHA-256( prev_hash + "|" + record )
//
// One kind of entry is written now:
//   result { game, player, moves, hands, totals, place }: a player's finished game: its number, the player (an id, never a
//         name), a SHA-256 of the moves they made (so they can show them later), how many hands it took, the final totals and
//         the place the server worked out by replaying the moves. The deal and the cards are never on the ledger, because
//         everyone who plays game N holds the same cards. (game_no, with the player, is UNIQUE: a game seals once.)
// Entries from before v0.9 stay on the chain and are still shown: 'day' { day, seed_hash, memory_hash } (a day's deal, its seed
// shown once the day was over), 'game' and 'practice' (a finished game with every move in it), and 'hand' (a single hand).
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
// again on the new head. Another UNIQUE clash (that player's result for that game) means it's already there.
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

export async function entryInsert(db, prev, { kind, day, playerId = null, game = null, record, t }) {
  const hash = await sha256(prev + "|" + record);
  return { hash, stmt: db.prepare("INSERT INTO pitch_ledger (kind, day, player_id, record, prev_hash, hash, created_at, game_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(kind, day, playerId, record, prev, hash, t, game) };
}
