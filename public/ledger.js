// The ledger page: the chain from /api/ledger, newest first. "Check the chain" fetches every entry and checks every hash in
// this browser (chain.js, the same check the Worker runs before a registry checkpoint). Entries from before numbered games
// that are from today come back with no record (hidden until the day is over), so for them only the link to the entry before is checked.
import { verifyChain } from "./chain.js";
import { VERSION } from "./version.js";

const $ = (id) => document.getElementById(id);
const SPOT = ["You", "lagspike", "mogger99", "tiltproof"];   // the same names the game uses (app.js)
const ORD = ["", "1st", "2nd", "3rd", "4th"];
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const full = (h) => `<span class="hx">${esc(h)}</span>`;   // a hash, whole
// "Oct 22nd, 2026, 22:39 HST": Hawaii time for everyone (Hawaii has no daylight saving, so it is always HST)
const when = (t) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Honolulu", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  const n = Number(p.day), suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${p.month} ${n}${suffix}, ${p.year}, ${p.hour}:${p.minute} HST`;
};
const totals = (t) => t.map((n, s) => `${SPOT[s]} ${n}`).join(" · ");
let oldest = null;

function row(e) {
  let ic, what, sub = "";
  if (e.kind === "day") {
    const r = JSON.parse(e.record);
    ic = "📅";
    what = `<b>${esc(r.day)}</b>: the day's deal was fixed`;
    sub = `seed hash ${full(r.seed_hash)}` + (r.memory_hash ? ` · table memory ${full(r.memory_hash)}` : "")
      + (e.seed ? `<br>seed ${full(e.seed)} (the day is over: anyone can rebuild its deals)` : "<br>seed shown once the day is over");
  } else if (e.kind === "result" || e.kind === "daily") {
    const r = JSON.parse(e.record), daily = e.kind === "daily";
    ic = r.place === 1 ? (daily ? "👑" : "🏆") : daily ? "☀️" : "🃏";
    const who = `${e.pfp ? esc(e.pfp) + " " : ""}<b>${e.name ? esc(e.name) : "Player " + esc(r.player)}</b>`, game = daily ? `Daily game #${esc(r.daily)}` : `game #${esc(r.game)}`;
    what = `${who} ${r.place === 1 ? "beat the table" : "placed " + ORD[r.place]} in ${game}`;
    // the four finals, best first: the player, then the table's three (their names come from the game's seed)
    const names = [e.name || "Player " + r.player, ...(e.table || []).map((t) => t.name)];
    const finals = r.totals.map((t, s) => ({ s, t, n: names[s] || SPOT[s] })).sort((x, y) => y.t - x.t || x.s - y.s)
      .map((x) => `<span class="${x.s === 0 ? "you" : ""}">${esc(x.n)} <b>${esc(x.t)}</b></span>`).join(" · ");
    sub = (daily ? `${esc(r.day)} · ` : "") + `${esc(r.hands)} rounds · first to 11<br>${finals}`;
    const f = e.field;
    if (f && f.games > 0) sub += `<br>${esc(f.games)} player${f.games === 1 ? "" : "s"} ${f.games === 1 ? "has" : "have"} finished it so far · ${Math.round((100 * f.places[0]) / f.games)}% beat the table · ${(f.hands / f.games).toFixed(1)} rounds on average`;
    sub += `<br>moves ${full(r.moves)}`;
  } else if (e.record === null) {
    ic = "🔒";
    what = `A ${e.kind === "practice" ? "practice game" : e.kind === "hand" ? "round" : "game"} on ${esc(e.day)}`;
    sub = "hidden until the day is over";
  } else {
    const r = JSON.parse(e.record);
    if (e.kind === "hand") {   // before v0.3, a day was one hand
      ic = "🃏";
      what = `Player ${esc(r.player)} played ${esc(r.day)}'s round`;
      sub = `bid ${esc(r.bid)} · scored ${esc(r.final)}`;
    } else {
      ic = e.kind === "practice" ? "🎲" : r.place === 1 ? "🏆" : "🃏";
      what = `Player ${esc(r.player)} ${r.place === 1 ? "beat the table" : "placed " + ORD[r.place]}${e.kind === "practice" ? " in a practice game" : ""}`;
      sub = `${esc(r.day)} · ${esc(r.hands)} rounds · ${esc(totals(r.totals))}` + (r.seed ? `<br>seed ${full(r.seed)}` : "");
    }
  }
  return `<li class="entry${e.record === null ? " hidden" : ""}"><span class="ic">${ic}</span><span class="what">${what}</span>
    <span class="sub">${sub}<br>hash ${full(e.hash)}<br><span class="h">#${e.id} · ${when(e.created_at)}</span></span></li>`;
}

async function page() {
  const { entries } = await (await fetch("/api/ledger?limit=50" + (oldest ? "&before=" + oldest : ""))).json();
  $("entries").insertAdjacentHTML("beforeend", entries.map(row).join(""));
  if (entries.length) oldest = entries[entries.length - 1].id;
  $("more").hidden = entries.length < 50;
  if (!entries.length && !oldest) $("entries").innerHTML = `<li class="entry"><span class="ic">🌱</span><span class="what">Nothing sealed yet.</span><span class="sub">A finished game seals its result here.</span></li>`;
}

$("check").addEventListener("click", async () => {
  $("checked").textContent = "Checking…";
  const all = [];
  for (let before = ""; ;) {
    const { entries } = await (await fetch("/api/ledger?limit=100&plain=1" + before)).json();
    all.push(...entries);
    if (entries.length < 100) break;
    before = "&before=" + entries[entries.length - 1].id;
  }
  const v = await verifyChain(all.reverse());
  $("checked").textContent = !v.ok ? `The chain breaks at entry #${v.at}.`
    : `All ${all.length} entries link up${v.hidden ? `, and every hash checks out except today's ${v.hidden} hidden one${v.hidden === 1 ? "" : "s"} (linked, not rehashed)` : ", and every hash checks out"}.`;
});
$("more").addEventListener("click", page);
$("ver").textContent = VERSION;
page();
