// Nano Pitch page: you against the table. The table is one robot that plays the other three hands, each with a gen-z name
// (aura-farm's lists) that the game's seed picks (left, top, right); a day is one game to 11 points over as many hands as it takes. The look follows aura-farm:
// dark, purple glow, rounded panels. Everything is drawn into #app from the last answer of /api/today, /api/act or
// /api/practice*.
import { VERSION } from "./version.js";
import { suitOf, rankOf, HUMAN, PFP_POOL } from "./engine/pitch.js";

const SUIT = ["♣", "♦", "♥", "♠"];
const RED = [false, true, true, false];
const RANK = { 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };
const ORD = ["", "1st", "2nd", "3rd", "4th"];
const ICON = { table: "🤖", high: "👑", low: "🪶", jack: "🃏", game: "🎯", bid: "🔥" };

const $app = document.getElementById("app");

let T = null;          // the last answer: { day, n, view, field, practice }
let mode = "loading";  // loading | game | account
let busy = false;
let seen = 0;          // how many finished hands the player has been shown the result of
let msg = "";
let acct = null, newCode = null, acctMsg = "";
let myPfp = "😎";      // the player's own profile pic (their choice, kept on the server; 😎 until they pick one)
let picking = false;   // the profile pic picker is open on the account screen

// ---------- small helpers ----------

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rk = (c) => RANK[rankOf(c)] || String(rankOf(c));
const signed = (n) => (n > 0 ? "+" + n : String(n));
const pad2 = (n) => String(n).padStart(2, "0");
// Seats in play order: you, then the table's three hands clockwise. Their names and profile pics come with the game (view.cast).
const pfp = (seat) => (seat === HUMAN ? myPfp : T.view.cast[seat].pfp);
const tag = (seat) => (seat === HUMAN ? `<b>You</b>` : `<span class="tag s${seat}">${esc(T.view.cast[seat].name)}</span>`);   // a hand's name, in its seat's colour
const who = (seat) => `${pfp(seat)} ${tag(seat)}`;
const suitChip = (s) => `<span class="chip">Trump <b style="color:${RED[s] ? "var(--red)" : "var(--ink)"}">${SUIT[s]}</b></span>`;

function card(c, cls = "", k = null) {
  const inner = `<b>${rk(c)}</b><i>${SUIT[suitOf(c)]}</i>`, red = RED[suitOf(c)] ? " red" : "";
  return k ? `<button class="pc${red} ${cls}" data-k="${k}" aria-label="${rk(c)}${SUIT[suitOf(c)]}">${inner}</button>`
           : `<div class="pc${red} ${cls}">${inner}</div>`;
}
const backs = (n) => `<div class="backs">${"<i></i>".repeat(n)}</div>`;

function untilMidnight() {
  const now = new Date(), next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}
function stamp(day) {
  return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// ---------- replay: the moves one at a time ----------
// The server answers a move with the table after every bot has played. The page plays the new bids and cards back one at a
// time from what it already showed. A hand's moves in order are its bids, then every card of its finished tricks, then the
// trick on the table; a finished hand's come from its summary in `history`.

export const PACE = { move: 1300, trick: 2650, east: 650 };   // ms after a bid or card, after the card that ends a trick, and after East's, when it is your turn next
let rp = null;   // the replay on screen: { h, base, tmpl, k, evs }

const progress = (v) => v.bids.length + 4 * v.tricks.length + v.trick.length;
const events = (h) => [...h.bids.map((b) => ({ seat: b.seat })), ...h.tricks.flatMap((t) => t.plays), ...(h.trick || [])];

// The table after the first k moves of hand h. `base` is the player's cards before any of the replayed moves; `tmpl` gives
// everything that isn't the hand's moves (totals, hand number, dealer).
function frame({ h, base, tmpl, k, evs }) {
  const nb = Math.min(k, h.bids.length), plays = evs.slice(h.bids.length, Math.max(h.bids.length, k));
  const full = Math.floor(plays.length / 4), counts = [6, 6, 6, 6], mine = [];
  for (const p of plays) { counts[p.seat]--; if (p.seat === HUMAN) mine.push(p.card); }
  const settled = nb === 4;
  return {
    ...tmpl, dealer: h.dealer, bids: h.bids.slice(0, nb), tricks: h.tricks.slice(0, full), trick: plays.slice(full * 4),
    counts, hand: base.filter((c) => !mine.includes(c)), phase: settled ? "play" : "bid",
    pitcher: settled ? h.pitcher : null, bid: settled ? h.bid : 0, trump: plays.length ? suitOf(plays[0].card) : null,
    turn: k < evs.length ? evs[k].seat : null, legal: null, bidOptions: null,
  };
}

// Plays hand h back from move `from` to its end, then calls `then`. The player's own move shows at once.
function replay(h, base, from, tmpl, then) {
  const evs = events(h);
  if (from >= evs.length) { rp = null; return then(); }
  rp = { h, base, tmpl, k: from, evs };
  const run = rp;
  const step = () => {
    if (rp !== run) return;
    run.k++; draw();
    const p = run.k > h.bids.length ? run.k - h.bids.length : 0;   // cards played so far
    const wait = p && p % 4 === 0 ? PACE.trick : run.k >= evs.length && evs[run.k - 1].seat === 3 ? PACE.east : PACE.move;
    setTimeout(() => { if (rp !== run) return; if (run.k >= evs.length) { rp = null; then(); } else step(); }, wait);
  };
  if (evs[from].seat === HUMAN) step(); else { draw(); setTimeout(step, PACE.move); }
}

// After a move: play back what changed between the table as it was (`old`) and the server's answer (`now`).
function playBack(old, now) {
  if (now.history.length > old.history.length) {   // the move ended a hand: finish it, then its result screen shows
    const s = now.history[old.history.length];
    return replay({ dealer: s.dealer, bids: s.bids, tricks: s.tricks, trick: [], pitcher: s.pitcher, bid: s.bid }, old.hand, progress(old), old, draw);
  }
  replay(now, old.hand, progress(old), now, draw);
}
const playFromStart = () => { const v = T.view; if (!v.over) replay(v, v.hand, 0, v, draw); else draw(); };

// The moves of the hand on screen, as chat lines ("tiltproof: passes"). The table shows the newest FEED of them in its corner,
// like a stream's chat: a new line slides in from below, the older ones slide up, and the oldest fades out.
const FEED = 5;
let fed = 0;   // how many lines the feed held the last time the table was drawn
const cardTxt = (c) => `<span class="ct${RED[suitOf(c)] ? " r" : ""}">${rk(c)}${SUIT[suitOf(c)]}</span>`;
function moveLines(v) {
  const you = (s) => s === HUMAN, nm = (s) => `${pfp(s)} ${tag(s)}`, es = (s, a, b) => (you(s) ? a : b);
  const E = v.bids.map((b) => [b.seat, b.forced ? "stuck 2" : b.bid ? `${es(b.seat, "bid", "bids")} ${b.bid}` : es(b.seat, "pass", "passes")]);
  if (v.pitcher !== null) E.push([v.pitcher, `${es(v.pitcher, "have", "has")} the bid`]);
  let first = true;
  for (const t of [...v.tricks, { plays: v.trick, winner: null }]) {
    for (const p of t.plays) {
      E.push([p.seat, first ? `${es(p.seat, "lead", "leads")} ${cardTxt(p.card)}` : `${es(p.seat, "play", "plays")} ${cardTxt(p.card)}`]);
      first = false;
    }
    if (t.winner !== null) E.push([t.winner, `${es(t.winner, "take", "takes")} trick`]);
  }
  // Now and then a bot posts just an emoji after its move. Which moves and which emoji come from the move's place in the hand, so a replay or reload chats the same.
  const EMOTE = [["😴", "🥱", "💤", "🫠"], ["🗿", "😐", "💀", "🔥"], ["😤", "🥶", "🤬", "🧊"], ["🙂", "😶", "👍", "🤷"]];   // by personality: safe, bold, crowd, none
  const mood = (s, i) => { const h = [...`${v.no}|${i}|${s}`].reduce((x, c) => (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0, 7); return h % 8 === 0 ? EMOTE[v.cast[s].persona ?? 3][(h >> 4) % 4] : null; };
  return E.flatMap(([s, text], i) => { const e = s !== HUMAN && mood(s, i); return [`${nm(s)}: ${text}`, ...(e ? [`${nm(s)}: ${e}`] : [])]; });
}

// The feed's HTML: the newest FEED lines, plus one more above them (hidden) that fades out as a new line arrives. `fresh` is
// how many lines this draw added, which only happens while moves play out; the page animates those in `chat`.
function feedHtml(v) {
  const L = moveLines(v), fresh = rp ? L.length - (L.length >= fed ? fed : 0) : 0;
  fed = L.length;
  const rows = L.slice(-(FEED + 1)), out = rows.length > FEED;
  return `<div class="feed" aria-live="polite" data-fresh="${fresh}">${rows.map((l, i) => (out && i === 0 ? `<div class="out" aria-hidden="true">${l}</div>` : `<div>${l}</div>`)).join("")}</div>`;
}

// Slides the feed's new lines up from below and fades them in, with the older lines gliding up to make room.
function chat() {
  const feed = document.querySelector(".feed"), n = feed ? Math.min(Number(feed.dataset.fresh) || 0, feed.children.length) : 0;
  if (!n || !feed.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rows = [...feed.children], lift = rows.slice(-n).reduce((h, r) => h + r.offsetHeight + 2, 0);   // 2px: the feed's gap
  const op = rows.map((r) => Number(getComputedStyle(r).opacity));   // a line comes from the dimness of the place n lines nearer the end
  rows.forEach((r, i) => r.animate([{ transform: `translateY(${lift}px)`, opacity: i + n < rows.length ? op[i + n] : 0 }, { transform: "none", opacity: op[i] }],
    { duration: 280, easing: "ease-out" }));
}

// ---------- drawing ----------

function draw() {
  const typed = document.getElementById("codein")?.value;   // typing survives a redraw
  $app.classList.toggle("busy", busy);
  $app.innerHTML = { loading: loadingScreen, game: gameScreen, account: accountScreen }[mode]() + `<div class="ver">${esc(VERSION)}</div>`;
  const box = document.getElementById("codein");
  if (box && typed != null) box.value = typed;
  chat();
}

function header() {
  const sub = T ? `${stamp(T.day)}${T.game ? ` · Game #${T.game}` : ""} · ${T.view.over ? "Final" : "Hand " + (T.view.no + 1)}` : "one game a day";
  const right = mode === "account" ? `<span class="row" style="gap:14px"><a class="link" href="ledger.html">Ledger</a><button class="link" data-k="esc">Back</button></span>`
    : `<span class="row" style="gap:14px">${T && T.practice ? `<button class="link" data-k="daily">Today's game</button>` : `<button class="link" data-k="practice">New game</button>`}<a class="link" href="ledger.html">Ledger</a><button class="link" data-k="a">Account</button></span>`;
  return `<header><div class="title">NANO PITCH<small>${esc(sub)}</small></div>${right}</header>`;
}

function loadingScreen() { return header() + `<div class="panel"><p class="hint">${esc(msg || "Dealing…")}</p></div>`; }

// You and the table's three hands, with the running totals and, under each score, how close that hand is to 11.
function scoreboard(v) {
  const top = Math.max(...v.totals);
  const cell = (seat) => {
    const t = v.totals[seat], pct = Math.min(t < 0 ? 120 : 100, (100 * Math.abs(t)) / v.target);   // below zero the bar runs left, out of its frame
    return `<div class="score${seat === HUMAN ? " you" : ""}${v.totals[seat] === top && top > 0 ? " lead" : ""}">
      <div class="em">${pfp(seat)}</div><div class="nm">${tag(seat)}</div><div class="pt">${t}</div><div class="bar${t < 0 ? " neg" : ""}"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
  };
  return `<div class="panel"><div class="scores">${[0, 1, 2, 3].map(cell).join("")}</div></div>`;
}

// ---------- the table ----------

const pending = () => T.view.history.length > seen;   // a finished hand whose result hasn't been shown yet

function bidText(v, seat) {
  if (v.phase === "play" && seat !== v.pitcher) return "";   // once the bidding is over only the bidder's bid stays up
  const b = v.bids.find((x) => x.seat === seat);
  if (!b) return v.phase === "bid" && v.turn === seat ? `<span class="small">${seat === HUMAN ? "your bid" : "thinking…"}</span>` : "";
  const suit = seat === v.pitcher && v.trump !== null ? ` <b style="color:${RED[v.trump] ? "var(--red)" : "var(--ink)"}">${SUIT[v.trump]}</b>` : "";   // the suit is known once the bidder has led
  if (b.forced) return `<span class="chip">stuck 2${suit}</span>`;
  return b.bid ? `<span class="chip${seat === v.pitcher ? " hot" : ""}">bid ${b.bid}${suit ? " in" + suit : ""}</span>` : `<span class="small">pass</span>`;
}

// The trick on the table: the current one, or, while moves play out, the last finished one (with its winner lit).
function tableTrick(v) {
  if (v.trick.length) return { plays: v.trick, done: false };
  if (!rp) return { plays: [], done: false };   // the pause is over: the table is clear for the next lead
  const last = v.tricks[v.tricks.length - 1];
  return last ? { plays: last.plays, done: true, winner: last.winner } : { plays: [], done: false };
}

function gameScreen() {
  const v = rp ? frame(rp) : T.view;
  if (!rp) {
    if (pending()) return handScreen(v.history[seen]);
    if (v.over) return finalScreen();
  }
  const tt = tableTrick(v);
  const played = (seat, cls) => {
    const p = tt.plays.find((x) => x.seat === seat);
    return p ? `<div class="${cls}">${card(p.card, tt.done ? (tt.winner === seat ? "win" : "dim") : "")}</div>` : "";
  };
  const dealer = (seat) => (v.dealer === seat ? '<span class="d">D</span>' : "");
  const spot = (seat, cls) => `<div class="seat ${cls}${v.turn === seat ? " turn" : ""}">
      <div class="nm">${pfp(seat)} ${tag(seat)}${dealer(seat)}</div>${backs(v.counts[seat])}<div class="bid">${bidText(v, seat)}</div></div>`;
  const middle = v.phase === "bid" ? `<div class="mid"><span class="bot">${ICON.table}</span><br>bidding</div>` : (tt.plays.length ? "" : `<div class="mid"><span class="bot">${ICON.table}</span></div>`);

  const legal = new Set(v.legal || []), canPlay = !rp && v.phase === "play" && v.turn === HUMAN;
  const hand = v.hand.map((c) => (canPlay && legal.has(c) ? card(c, "ok", "c" + c) : card(c, canPlay ? "no" : ""))).join("");

  let controls = "", bidding = "";
  if (!rp && v.phase === "bid" && v.turn === HUMAN) {
    bidding = `<div class="bids">${[0, 2, 3, 4].map((b) => `<button data-k="b${b}" class="${b === 0 ? "hot" : ""}" ${v.bidOptions.includes(b) ? "" : "disabled"}>${b ? b : "Pass"}</button>`).join("")}</div>`;
  } else if (canPlay) {
    controls = `<p class="hint">${v.trick.length || v.trump !== null ? "Play a card" : "Your lead names trump"}</p>`;
  }

  const trumpTxt = v.trump === null ? "" : ` <b style="color:${RED[v.trump] ? "var(--red)" : "var(--ink)"}">${SUIT[v.trump]}</b>`;
  const chips = `<div class="row">${v.pitcher === null ? "" : `<span class="chip">Bidder ${tag(v.pitcher)} ${v.bid}${trumpTxt}</span>`}
    </div>`;

  return header() + scoreboard(v) + `
    <div class="panel table">
      ${feedHtml(v)}
      ${spot(2, "n")}${spot(1, "w")}
      <div class="center">${played(2, "tn")}${played(1, "tw")}${middle}${played(3, "te")}${played(0, "ts")}</div>
      ${spot(3, "e")}
      <div class="seat s${v.turn === HUMAN ? " turn" : ""}"><div class="nm">${pfp(0)} ${tag(0)}${dealer(0)}</div><div class="bid">${bidText(v, 0)}</div></div>
    </div>
    ${bidding}
    ${chips}
    <div class="hand">${hand}</div>
    ${controls}
    <p class="msg">${esc(rp ? "" : msg)}</p>`;
}

// ---------- the result of a hand, and of the game ----------

function handScreen(h) {
  const v = T.view, last = h.no === v.history.length - 1;
  const row = (label, value) => `<div class="kv"><span>${label}</span><span>${value}</span></div>`;
  const delta = (n) => `<span class="${n > 0 ? "up" : n < 0 ? "down" : "small"}">${signed(n)}</span>`;
  return header() + scoreboard(v) + `
    <div class="panel handover">
      <div class="between"><div class="big" style="font-size:24px">HAND ${h.no + 1} OVER</div>${suitChip(h.trump)}</div>
      <div class="rows">
        ${row(`${ICON.high} High`, `${who(h.high.seat)} ${card(h.high.card, "mini")}`)}
        ${row(`${ICON.low} Low`, `${who(h.low.seat)} <span class="small">won the trick with</span> ${card(h.low.card, "mini")}`)}
        ${row(`${ICON.jack} Jack`, h.jack ? `${who(h.jack.seat)} ${card(h.jack.card, "mini")}` : `<span class="small">not in play</span>`)}
        ${row(`${ICON.game} Game`, h.gameWinner === null ? `<span class="small">tied: nobody</span>` : `${who(h.gameWinner)} <span class="small">${h.gameTotals[h.gameWinner]} card points</span>`)}
        ${row(`${ICON.bid} Bid`, `${who(h.pitcher)} bid ${h.bid}: ${h.made ? `<b class="up">made it</b>` : `<b class="down">set ${-h.bid}</b>`}`)}
        ${row("This hand", [0, 1, 2, 3].map((s) => `${tag(s)} ${delta(h.final[s])}`).join(" "))}
      </div>
      <button class="go" data-k="go">${last && v.over ? "See the result" : "Next hand"}</button>
    </div>`;
}

function finalScreen() {
  const v = T.view, f = T.field, place = v.place;
  const winner = v.totals.indexOf(Math.max(...v.totals));
  const headline = place === 1 ? "YOU BEAT THE TABLE" : "THE TABLE WINS";
  const sub = place === 1 ? `first to ${v.target} in ${v.history.length} hands` : `${tag(winner)} got there first · you placed ${ORD[place]}`;
  const finals = v.history.map((h) => { const n = h.final[HUMAN]; return `<span class="chip ${n > 0 ? "up" : n < 0 ? "down" : ""}">${signed(n)}</span>`; }).join("");
  let field = "";
  if (!T.practice && f && f.games > 0) {
    const won = Math.round((100 * f.places[0]) / f.games);
    field = `<div class="panel">
      <div class="kv"><span>The field</span><span>${f.games} player${f.games === 1 ? "" : "s"} on these deals</span></div>
      <div class="kv"><span>Beat the table</span><span>${f.games === 1 ? "you're the first to finish today" : `${won}% of players`}</span></div>
      <div class="kv"><span>Average game</span><span>${(f.hands / f.games).toFixed(1)} hands</span></div></div>`;
  }
  // The table's memory at work: how many of the bots' bids this game went with what the table remembered.
  const botBids = v.history.flatMap((h) => h.bids.filter((b) => b.seat !== HUMAN && !b.forced));
  const followed = [1, 2, 3].map((s) => ({ s, n: botBids.filter((b) => b.seat === s && b.crowd).length })).filter((x) => x.n);
  const memory = `<div class="panel"><div class="kv"><span>The table's memory</span><span>${botBids.filter((b) => b.crowd).length} of ${botBids.length} bot bids went with the crowd</span></div>
      ${followed.length ? `<div class="small">${followed.map((x) => `${tag(x.s)} ${x.n}`).join(" · ")}</div>` : `<div class="small">The table hasn't seen enough hands like these yet.</div>`}</div>`;
  const buttons = T.practice
    ? `<button class="go" data-k="practice">Another practice game</button><button class="ghost" data-k="daily">Back to today</button>`
    : `<button class="go" data-k="practice">Practice game</button><p class="hint">Next deal in <span data-clock>${untilMidnight()}</span></p>`;
  return header() + `
    <div class="panel"><div class="big">${headline}</div><p class="hint" style="margin:6px 0 0">${sub}</p></div>
    ${scoreboard(v)}
    <div class="panel"><div class="small" style="margin-bottom:8px">Your score each hand</div><div class="hands">${finals}</div></div>
    ${field}
    ${memory}
    <p class="msg">${esc(msg)}</p>
    ${buttons}`;
}

// ---------- the account (save codes and passkeys, from the shared 88x31 accounts) ----------

function accountScreen() {
  const a = acct || { player: false, codes: [], passkeys: [], devices: 0 };
  return header() + `
    <div class="panel">
      <div class="row" style="flex-wrap:nowrap;gap:12px">
        ${a.player ? `<button class="avatar" data-k="pfp" aria-label="Change your profile pic">${myPfp}</button>` : ""}
        <div class="big" style="font-size:22px;text-align:left">${a.player ? `${esc(a.name || "player " + a.id)}'s account` : "ACCOUNT"}</div>
      </div>
      ${a.player && picking ? `<div class="picker">${PFP_POOL.map((e, i) => `<button class="${e === myPfp ? "on" : ""}" data-k="e${i}">${e}</button>`).join("")}</div>` : a.player ? `<p class="small" style="margin:6px 0 0">Tap your pic to change it.</p>` : ""}
      <p class="small">${!a.player ? "No player here yet: play a card, or log in below."
        : a.codes.length || a.passkeys.length ? `<b class="up">Logged in</b> on ${a.devices} device${a.devices === 1 ? "" : "s"}.`
        : `<b>Guest:</b> no save code or passkey yet, so this player lives only in this browser.`}
        A save code or passkey brings your game to another device.</p>
      ${a.player ? `<div class="row"><button class="ghost" style="flex:1" data-k="name">New name</button><button class="ghost" style="flex:1" data-k="out">Log out</button></div>` : ""}
      ${newCode ? `<div class="kv"><span>New save code</span><span class="code">${esc(newCode)}</span></div>
        <div class="row" style="margin-bottom:8px"><button class="ghost" style="flex:1" data-k="copy">Copy</button><button class="ghost" style="flex:1" data-k="dl">Download</button></div>
        <p class="small">Shown once. Keep it somewhere safe.</p>` : ""}
      <div class="kv"><span>Save codes</span><span>${a.codes.length}/5 <button class="link" data-k="new">new code</button></span></div>
      <div class="kv"><span>Passkeys</span><span>${a.passkeys.length} ${pkOk() ? `<button class="link" data-k="pk">add passkey</button>` : `<span class="small">this browser can't do passkeys</span>`}</span></div>
    </div>
    <div class="panel">
      <div class="small" style="margin-bottom:8px">Log in on this device</div>
      <input id="codein" class="codein" maxlength="40" spellcheck="false" autocomplete="off" placeholder="Save code" aria-label="Save code">
      <div class="row" style="margin-top:8px"><button class="go" style="flex:1" data-k="use">Use code</button>${pkOk() ? `<button class="ghost" style="flex:1;height:54px" data-k="pkin">Passkey</button>` : ""}</div>
    </div>
    <p class="msg">${esc(acctMsg)}</p>`;
}

// ---------- talking to the server ----------

async function api(path, data) {
  const r = await fetch("/api/" + path, data ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) } : {});
  return r.json().catch(() => ({ error: "That didn't work. Try again." }));
}

async function load() {
  api("account").then((a) => { if (a && a.pfp && a.pfp !== myPfp) { myPfp = a.pfp; if (mode === "game") draw(); } });   // the player's own pic, when they have one
  const r = await api("today");
  if (r.error) { msg = r.error; mode = "loading"; return draw(); }
  T = { ...r, practice: null };
  msg = r.reset ? "The bots changed since your last move, so today's game started over." : "";
  mode = "game"; seen = T.view.history.length;   // a game reloaded in progress doesn't replay old results
  rp = null;
  if (T.n === 0) playFromStart();   // a new game: the bids before yours play out
  else draw();
}

async function practice() {
  if (busy) return;
  busy = true; msg = ""; draw();
  const r = await api("practice/new", {});
  busy = false;
  if (r.error) { msg = r.error; return draw(); }
  T = { day: T.day, n: r.n, game: r.game, view: r.view, field: null, practice: r.practice }; seen = T.view.history.length; playFromStart();
}

async function send(action) {
  if (busy || !T) return;
  busy = true; msg = ""; draw();
  const r = T.practice ? await api("practice/act", { id: T.practice, n: T.n, action }) : await api("act", { day: T.day, n: T.n, action });
  busy = false;
  const old = T.view;
  if (r.view) T = { day: T.day, n: r.n, view: r.view, field: r.field, practice: T.practice, game: r.game };   // a refused move still brings the game as it is
  if (r.error) msg = r.error;
  else if (r.view.over) msg = "Sealed on the ledger.";
  if (r.view && !r.error) playBack(old, r.view); else draw();
}

// ---------- passkeys (WebAuthn in the browser, copied from moba-beat public/account.js) ----------

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (t) => { t = t.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0)); };
const pkOk = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
const device = () => { const u = navigator.userAgent; return /Android/.test(u) ? "Android" : /iPhone|iPad/.test(u) ? "iPhone" : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows PC" : "This device"; };
const pkOops = (e) => (e && e.name === "NotAllowedError" ? "Passkey cancelled (or it timed out)." : (e && e.message) || "The passkey didn't work.");

async function pickPfp(e) {
  const r = await api("pfp", { pfp: e });
  if (r.error) return openAccount(r.error);
  myPfp = r.pfp; picking = false; await openAccount("Profile pic changed.");
}
async function openAccount(m = "") { acctMsg = m; acct = await api("account"); if (acct.pfp) myPfp = acct.pfp; mode = "account"; draw(); }
async function changed(m) { newCode = null; await load(); await openAccount(m); }

const ACCOUNT_KEYS = {
  async new() { const r = await api("codes", { action: "new" }); if (r.error) return openAccount(r.error); newCode = r.code; await load(); await openAccount(); },
  async copy() { try { await navigator.clipboard.writeText(newCode); acctMsg = "Copied. Keep it somewhere safe."; } catch { acctMsg = "Couldn't copy. Write it down instead."; } draw(); },
  async dl() {
    const text = `Daily Pitch save code\r\n\r\n  ${newCode}\r\n\r\nOn any browser: open ${location.origin}, open Account, and use this code under "Log in on this device".\r\nIt works in the other 88x31 games too. Keep it private: anyone with it can log in as you.\r\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = "daily-pitch-save-code.txt";
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  async use() { const code = (document.getElementById("codein")?.value || "").trim(); const r = await api("load", { code }); if (r.error) return openAccount(r.error); await changed("Logged in."); },
  async pfp() { picking = !picking; draw(); },
  async name() { const r = await api("name", {}); if (r.error) return openAccount(r.error); await openAccount(`You're ${r.name} now.`); },
  async out() { const r = await api("logout", {}); if (r.error) return openAccount(r.error); await changed("Logged out."); },
  async pk() {
    acctMsg = "Waiting for your fingerprint, face or PIN…"; draw();
    try {
      const o = await api("passkey", { action: "register_options" }); if (o.error) return openAccount(o.error);
      const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64(o.challenge), user: { ...o.user, id: unb64(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: unb64(c.id) })) } });
      const r = await api("passkey", { action: "register", label: device(), credential: { id: cred.id, response: { clientDataJSON: b64(cred.response.clientDataJSON), attestationObject: b64(cred.response.attestationObject) } } });
      if (r.error) return openAccount(r.error);
      await changed("Passkey added.");
    } catch (e) { acctMsg = pkOops(e); draw(); }
  },
  async pkin() {
    acctMsg = "Waiting for your passkey…"; draw();
    try {
      const o = await api("passkey", { action: "login_options" }); if (o.error) return openAccount(o.error);
      const cred = await navigator.credentials.get({ publicKey: { ...o, challenge: unb64(o.challenge) } });
      const r = await api("passkey", { action: "login", credential: { id: cred.id, response: { clientDataJSON: b64(cred.response.clientDataJSON), authenticatorData: b64(cred.response.authenticatorData), signature: b64(cred.response.signature) } } });
      if (r.error) return openAccount(r.error);
      await changed("Logged in.");
    } catch (e) { acctMsg = pkOops(e); draw(); }
  },
  async esc() { mode = "game"; newCode = null; picking = false; draw(); },
};

// ---------- input: taps and keys do the same things ----------

function press(k) {
  if (mode === "account") {
    if (/^e\d+$/.test(k)) return pickPfp(PFP_POOL[Number(k.slice(1))]);
    const f = ACCOUNT_KEYS[k]; if (f) f(); return;
  }
  if (mode !== "game" || !T) return;
  if (k === "a") return openAccount();
  if (rp) return;   // moves are playing out
  const v = T.view;
  if (k === "go") { if (pending()) { seen = v.history.length; msg = ""; playFromStart(); } return; }
  if (k === "practice" && !T.practice) return practice();
  if (k === "daily" && T.practice) return load();
  if (pending()) return;   // the result of a hand is on screen: moves wait until it's dismissed
  if (k[0] === "b" && v.phase === "bid") return send({ type: "bid", bid: Number(k.slice(1)) });
  if (k[0] === "c" && v.phase === "play") return send({ type: "play", card: Number(k.slice(1)) });
}

$app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-k]");
  if (el && !el.disabled) press(el.dataset.k);
});

document.addEventListener("keydown", (e) => {
  if (e.target && e.target.id === "codein") { if (e.key === "Enter") press("use"); else if (e.key === "Escape") press("esc"); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const key = e.key.toLowerCase();
  if (mode === "account") {
    const map = { n: "new", c: "copy", d: "dl", u: "use", k: "pk", g: "pkin", o: "out", escape: "esc" };
    if (map[key]) { e.preventDefault(); press(map[key]); }
    return;
  }
  if (mode !== "game" || !T) return;
  const v = T.view;
  if (key === "a") return press("a");
  if (rp) return;
  if (pending()) { if (key === "enter" || key === " ") { e.preventDefault(); press("go"); } return; }
  if (v.over) { if (key === "p") press("practice"); else if (key === "t") press("daily"); return; }
  if (v.phase === "bid" && v.turn === HUMAN) {
    const bid = key === "p" || key === "0" ? 0 : ["2", "3", "4"].includes(key) ? Number(key) : null;
    if (bid !== null && v.bidOptions.includes(bid)) send({ type: "bid", bid });
    return;
  }
  if (v.phase === "play" && v.turn === HUMAN && /^[1-6]$/.test(key)) {
    const c = v.hand[Number(key) - 1];
    if (c !== undefined && (v.legal || []).includes(c)) send({ type: "play", card: c });
  }
});

// the countdown on the final screen: only its own text changes
setInterval(() => { for (const n of document.querySelectorAll("[data-clock]")) n.textContent = untilMidnight(); }, 1000);
load().then(() => { if (location.hash === "#account") { history.replaceState(null, "", location.pathname); openAccount(); } });   // the ledger page's Account link
