// Players' names: random gen-z two-word names like "Cracked Goblin" (the same generator as the bots', from aura-farm's lists). A player gets one the
// first time their account is looked at, and can reroll it any time (POST /api/name); names can't be typed. They are unique
// ignoring case. The sealed ledger records never carry a name (only the player number); the ledger page shows a player's current name beside
// each finished game.
import { gamerTag } from "../public/engine/pitch.js";

// Give this player a name nobody has, if they have none (or a different one, with reroll). Returns the name.
export async function giveName(env, id, current, { reroll = false, rand = Math.random, first = null } = {}) {
  if (current && !reroll) return current;
  for (let i = 0; i < 40; i++) {
    const name = i === 0 && first ? first : gamerTag(rand);   // `first`: a name the server itself showed this visitor before they were a player
    if (name === current) continue;
    try {
      const r = await env.DB.prepare(`UPDATE pitch_players SET name = ?, name_key = ? WHERE id = ?${reroll ? "" : " AND name IS NULL"}`)
        .bind(name, name.toLowerCase(), id).run();
      if (!r.meta.changes) return (await env.DB.prepare("SELECT name FROM pitch_players WHERE id = ?").bind(id).first())?.name ?? null;
      return name;
    } catch (e) {
      if (!String(e.message).includes("UNIQUE")) throw e;   // taken: try another
    }
  }
  return current ?? null;
}
