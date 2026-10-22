// The daily deal: everyone gets the same shuffle each UTC day, and nobody can work it out ahead of time.
// Seed = HMAC-SHA256(secret, "daily:" + "YYYY-MM-DD"). The secret lives only on the server (a Cloudflare secret),
// so the browser never sees a seed until the day is over. Same method as scoundrel.exe's engine/daily.js.
// The ledger's day entry will hold seedHash(seed): it proves the deal was fixed before anyone played, and once
// the day is over the seed itself can be shown so anyone can check the deal.
// Uses Web Crypto: works in Workers, browsers, Node 18+.

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10); // "2026-10-22"
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function dailySeed(secret, day = utcDay()) {
  if (!secret) throw new Error("dailySeed needs the server secret.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Bad day "${day}".`);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("daily:" + day))));
}

// SHA-256 of the seed, as hex: what the ledger commits to before play.
export async function seedHash(seed) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed))));
}
