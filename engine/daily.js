// Seeds: the server's secret, run through HMAC-SHA256, so nobody can work out a deal ahead of time (same method as
// scoundrel.exe's engine/daily.js). dailySeed makes each UTC day's Daily game (and made the days' deals before v0.9: the
// ledger page still shows a past day's seed from it). gameSeed makes the numbered games (one per game number).
// Uses Web Crypto: works in Workers, browsers, Node 18+.

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10); // "2026-10-22"
}

// Daily games are numbered by UTC day: DAILY_START is Daily game #1, the next UTC day #2, and so on, the same for everyone.
export const DAILY_START = "2026-10-23";
const DAY_MS = 86400000;
export const dailyNo = (day = utcDay()) => Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(DAILY_START + "T00:00:00Z")) / DAY_MS) + 1;
export const dayOfDaily = (d) => new Date(Date.parse(DAILY_START + "T00:00:00Z") + (d - 1) * DAY_MS).toISOString().slice(0, 10);

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function dailySeed(secret, day = utcDay()) {
  if (!secret) throw new Error("dailySeed needs the server secret.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Bad day "${day}".`);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("daily:" + day))));
}

// Game n's deal (Nano Pitch's games are numbered 1, 2, 3...): HMAC-SHA256(secret, "game:" + n). Everyone who plays game n gets
// the same shuffle, and nobody can work out a deal before the game is asked for.
export async function gameSeed(secret, n) {
  if (!secret) throw new Error("gameSeed needs the server secret.");
  if (!Number.isInteger(n) || n < 1) throw new Error(`Bad game number "${n}".`);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("game:" + n))));
}
