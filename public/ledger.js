// The ledger page: the chain from /api/ledger, newest first. "Check the chain" fetches every entry and checks every hash in
// this browser (chain.js, the same check the Worker runs before a registry checkpoint). Entries from before numbered games
// that are from today come back with no record (hidden until the day is over), so for them only the link to the entry before is checked.
import { verifyChain } from "./chain.js";
import { VERSION } from "./version.js";
import { suitOf, rankOf } from "./engine/pitch.js";

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
const SUIT = ["♣", "♦", "♥", "♠"], RED = [false, true, true, false], RANK = { 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };
const seats = new Map();   // entry id -> the four names at that table, for the hands you can open
const cardTxt = (c) => `<span class="ct${RED[suitOf(c)] ? " r" : ""}">${RANK[rankOf(c)] || rankOf(c)}${SUIT[suitOf(c)]}</span>`;
const signed = (n) => (n > 0 ? "+" + n : String(n));

// One of your finished games, hand by hand: the bids, then each trick (who played what, and who took it), then High, Low, Jack, Game and the hand's scores.
function handsHtml(hands, names) {
  const nm = (s) => esc(names[s]);
  return [...hands].reverse().map((h) => {   // the newest round first
    const bids = h.bids.map((b) => `${nm(b.seat)} ${b.forced ? "stuck 2" : b.bid ? b.bid : "pass"}`).join(" · ");
    const tricks = h.tricks.map((t, i) => `<div>${i + 1}. ${t.plays.map((p) => `${nm(p.seat)} ${cardTxt(p.card)}`).join(" · ")} → <b>${nm(t.winner)}</b></div>`).reverse().join("");   // the newest trick first
    const pick = (x) => (x ? `${nm(x.seat)} ${cardTxt(x.card)}` : "not in play");
    const game = h.gameWinner === null ? "tied" : `${nm(h.gameWinner)} ${h.gameTotals[h.gameWinner]}`;
    return `<div><b>Round ${h.no + 1}: ${nm(h.pitcher)} bid ${h.bid} in <span class="${RED[h.trump] ? "r" : ""}">${SUIT[h.trump]}</span> and ${h.made ? "made it" : "got set"}</b>
      <div>Bids: ${bids}</div>${tricks}
      <div>High ${pick(h.high)} · Low ${pick(h.low)} · Jack ${pick(h.jack)} · Game ${game}</div>
      <div>${h.final.map((n, s) => `${nm(s)} ${signed(n)}`).join(" · ")}</div></div>`;
  }).join("");
}

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
    if (e.mine) { seats.set(e.id, ["You", ...(e.table || []).map((t) => t.name)]); sub += `<br><button class="link" type="button" data-hands="${daily ? 1 : 0}" data-n="${esc(daily ? r.daily : r.game)}" data-id="${e.id}">Show hands</button>`; }
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
    <span class="sub">${sub}<br>hash ${full(e.hash)}<br><span class="h">#${e.id} · ${when(e.created_at)}</span></span><div class="hands" hidden></div></li>`;
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
$("entries").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-hands]");
  if (!b) return;
  const box = b.closest("li").querySelector(".hands");
  if (!box.hidden) { box.hidden = true; b.textContent = "Show hands"; return; }
  const r = await (await fetch(`/api/hands?daily=${b.dataset.hands}&n=${b.dataset.n}`)).json().catch(() => ({ error: "That didn't work. Try again." }));
  box.innerHTML = r.error ? esc(r.error) : handsHtml(r.hands, seats.get(Number(b.dataset.id)));
  box.hidden = false; b.textContent = "Hide hands";
});
$("ver").textContent = VERSION;
page();
