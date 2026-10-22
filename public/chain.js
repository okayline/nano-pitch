// The hash chain's checks, shared by the Worker (its registry checkpoint) and the ledger page (public/ledger.html):
// hash = SHA-256( prev_hash + "|" + record ), the first entry chained from GENESIS. Copied from moba-beat public/chain.js,
// with one change: today's game records are hidden from the public (record null) until the day is over, so for those
// only the link to the entry before is checked, not the hash.

export const GENESIS = "0".repeat(64);

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Check rows (oldest first) form an unbroken chain from GENESIS: { ok: true, hidden } or { ok: false, at: id }.
// `hidden` is how many entries were hidden, so only linked, not rehashed.
export async function verifyChain(rows) {
  let p = GENESIS, hidden = 0;
  for (const r of rows) {
    if (r.prev_hash !== p) return { ok: false, at: r.id };
    if (r.record === null) hidden++;
    else if ((await sha256(p + "|" + r.record)) !== r.hash) return { ok: false, at: r.id };
    p = r.hash;
  }
  return { ok: true, hidden };
}

// Check the newest entry: `rows` are the last two entries (oldest first), or the only one. The newest must hash right
// and chain from the entry just before it. Older entries aren't checked again here (the ledger page checks them all),
// so this costs the same however long the ledger is. { ok: true } or { ok: false, at: id }.
export async function verifyTip(rows) {
  const last = rows[rows.length - 1], before = rows.length > 1 ? rows[0] : null, prev = before ? before.hash : GENESIS;
  const ok = (before ? before.id === last.id - 1 : last.id === 1) && last.prev_hash === prev && (await sha256(prev + "|" + last.record)) === last.hash;
  return ok ? { ok: true } : { ok: false, at: last.id };
}
