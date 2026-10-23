// Nano Pitch page: you against the table. The table is one robot that plays the other three hands, each with a gen-z name
// (aura-farm's lists) that the game's seed picks (left, top, right); a game is first to 11 points over as many hands as it takes,
// and games are numbered: everyone plays 1, 2, 3... in order. The look follows aura-farm:
// dark, purple glow, rounded panels. Everything is drawn into #app from the last answer of /api/game, /api/play or /api/act.
import { VERSION } from "./version.js";
import { suitOf, rankOf, HUMAN, PFP_POOL, gamerTag } from "./engine/pitch.js";

const SUIT = ["♣", "♦", "♥", "♠"];
const RED = [false, true, true, false];
const RANK = { 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };
const ORD = ["", "1st", "2nd", "3rd", "4th"];
const ICON = { table: "🤖", high: "👑", low: "🪶", jack: "🃏", game: "🎯", bid: "🔥" };

const $app = document.getElementById("app");

let T = null;          // the last answer: { game, n, view, field }
let mode = "loading";  // loading | game | account
let busy = false;
let seen = 0;          // how many finished hands the player has been shown the result of
let msg = "";
let acct = null, newCode = null, acctMsg = "";
let hotBid = 0;        // the bid lit on the bid panel: Pass at first, then the last one the mouse was on, until you bid
let myName = "";      // the player's own name, shown on their seat (empty until the server has one: the seat says "You")
let myPfp = "😎";      // the player's own profile pic (kept on the server; 😎 until they roll one)

// ---------- small helpers ----------

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rk = (c) => RANK[rankOf(c)] || String(rankOf(c));
const signed = (n) => (n > 0 ? "+" + n : String(n));
// Seats in play order: you, then the table's three hands clockwise. Their names and profile pics come with the game (view.cast).
const pfp = (seat) => (seat === HUMAN ? myPfp : T.view.cast[seat].pfp);
// A bot's name. If it is the player's own name, the bot gets another (the same one every time for that game and seat), so no two seats share a name.
function botName(seat) {
  const name = T.view.cast[seat].name, taken = (n) => [myName, ...[1, 2, 3].map((s) => T.view.cast[s].name)].some((x) => x && x.toLowerCase() === n.toLowerCase());
  if (!myName || name.toLowerCase() !== myName.toLowerCase()) return name;
  let h = [...`${T.game}|${seat}`].reduce((x, c) => (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0, 7);
  for (let i = 0; i < 50; i++) { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; const alt = gamerTag(() => h / 4294967296); if (!taken(alt)) return alt; }
  return name;
}
const tag = (seat) => (seat === HUMAN ? `<b>You</b>` : `<span class="tag s${seat}">${esc(botName(seat))}</span>`);   // a hand's name, in its seat's colour
const who = (seat) => `${pfp(seat)} ${tag(seat)}`;
const suitIcon = (s) => `<b style="color:${RED[s] ? "var(--red)" : "var(--ink)"}">${SUIT[s]}</b>`;
const nameOf = (seat) => (seat === HUMAN ? myName || "You" : botName(seat));   // a seat's plain name, for headlines

function card(c, cls = "", k = null) {
  const inner = `<b>${rk(c)}</b><i>${SUIT[suitOf(c)]}</i>`, red = RED[suitOf(c)] ? " red" : "";
  return k ? `<button class="pc${red} ${cls}" data-k="${k}" aria-label="${rk(c)}${SUIT[suitOf(c)]}">${inner}</button>`
           : `<div class="pc${red} ${cls}">${inner}</div>`;
}
const SAT = '<span class="sat">Sat out</span>';   // laid over the cards of a seat that was dealt no trump
const backs = (n, out) => `<div class="backs">${"<i></i>".repeat(n)}${out ? SAT : ""}</div>`;

// ---------- replay: the moves one at a time ----------
// The server answers a move with the table after every bot has played. The page plays the new bids and cards back one at a
// time from what it already showed. A hand's moves in order are its bids, then every card of its finished tricks, then the
// trick on the table; a finished hand's come from its summary in `history`.

export const PACE = { move: 1300, trick: 2650, east: 650, skip: 350 };   // ms after a bid or card, after the card that ends a trick, after East's, when it is your turn next, and for the quick hop of the turn over a seat sitting out
let rp = null;   // the replay on screen: { h, base, tmpl, k, evs }
let frozen = null;   // the table as the last replay left it: the round's summary pops up over it

// A trick's moves in turn order from its leader. A seat that sits out gets one quick move: the turn lands on it and straight away moves on.
function trickEvents(plays, out, trick) {
  if (!plays.length) return [];
  const evs = []; let seat = plays[0].seat, i = 0;
  for (let n = 0; n < 4; n++, seat = (seat + 1) % 4) {
    if (out && out[seat]) evs.push({ seat, skip: true, trick });
    else if (i < plays.length) evs.push({ ...plays[i++], trick });
    else break;   // the seat whose card hasn't been played yet
  }
  const active = out ? out.filter((o) => !o).length : 4;
  if (plays.length >= active) while (evs.length && evs[evs.length - 1].skip) evs.pop();   // a finished trick ends on its last card: the turn doesn't hop to a sitting-out seat after it
  return evs;
}
const events = (h) => [...h.bids.map((b) => ({ seat: b.seat })), ...h.tricks.flatMap((t, i) => trickEvents(t.plays, h.out, i)), ...trickEvents(h.trick || [], h.out, h.tricks.length)];
const progress = (v) => events(v).length;
const lastOf = (evs, trick) => evs.reduce((m, e, j) => (e.trick === trick ? j : m), -1);   // index of a trick's last move

// The table after the first k moves of hand h. `base` is the player's cards before any of the replayed moves; `tmpl` gives
// everything that isn't the hand's moves (totals, hand number, dealer).
function frame({ h, base, tmpl, k, evs, stage }) {
  const nb = Math.min(k, h.bids.length), shown = evs.slice(h.bids.length, Math.max(h.bids.length, k));
  const full = h.tricks.filter((_, i) => lastOf(evs, i) < k).length;   // tricks whose last move has been shown
  const cards = shown.filter((e) => e.card !== undefined), plays = cards.filter((e) => e.trick === full).map(({ seat, card }) => ({ seat, card }));
  const out = [0, 1, 2, 3].map((s) => shown.some((e) => e.skip && e.seat === s) || !!(evs[k]?.skip && evs[k].seat === s) || !!(full > 0 && h.out && h.out[s]));   // once the turn has reached a seat that sits out, it says "Sat out" for the rest of the round
  const counts = [6, 6, 6, 6], mine = [];
  for (const p of cards) { counts[p.seat]--; if (p.seat === HUMAN) mine.push(p.card); }
  const settled = nb === 4;
  return {
    ...tmpl, dealer: h.dealer, bids: h.bids.slice(0, nb), tricks: h.tricks.slice(0, full), trick: plays,
    counts, out, hand: base.filter((c) => !mine.includes(c)), phase: settled ? "play" : "bid",
    pitcher: settled ? h.pitcher : null, bid: settled ? h.bid : 0, trump: cards.length ? suitOf(cards[0].card) : null,
    turn: k < evs.length ? evs[k].seat : null, legal: null, bidOptions: null,
    hold: stage < 3 && k > 0 && !evs[k - 1].skip ? evs.slice(0, k).filter((e) => !e.skip).length - 1 : null, stage,   // the chat holds back the newest move's lines in turn: the move itself at stage 1, its follow-ups (its emoji, who took the trick, who has the bid) at stage 2, the chatters' reactions at stage 3
  };
}

// Plays hand h back from move `from` to its end, then calls `then`. The player's own move shows at once.
function replay(h, base, from, tmpl, then) {
  const evs = events(h);
  frozen = null;
  if (from >= evs.length) { rp = null; return then(); }
  rp = { h, base, tmpl, k: from, evs, stage: 3 };
  const ends = new Set(h.tricks.map((_, i) => lastOf(evs, i) + 1));   // after these moves a trick is over
  const run = rp;
  const step = () => {
    if (rp !== run) return;
    run.k++; run.stage = 0; draw();
    const k = run.k;
    const ev = evs[k - 1];
    const wait = ends.has(k) ? PACE.trick : ev.skip ? PACE.move - PACE.skip : evs[k]?.skip ? PACE.skip : k >= evs.length && ev.seat === 3 ? PACE.east : PACE.move;   // the turn hops over a seat that sits out quickly, and the next move comes as late as it would have
    // Chat arrives like a stream's: each line shows up a moment after its move, at a different moment each time (picked from the move's place in the hand): the move 12-40% of the way to the next move, its follow-ups (emoji, who took it) 42-60%, the chatters' reactions 68-85%.
    const jit = (salt) => ([...`${tmpl.no}|${k}|${salt}`].reduce((x, c) => (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0, 7) >>> 3) % 1000 / 1000;
    const at = (stage, from, span) => setTimeout(() => { if (rp === run && run.k === k) { run.stage = stage; draw(); } }, wait * (from + span * jit(stage)));
    at(1, 0.12, 0.28); at(2, 0.42, 0.18); at(3, 0.68, 0.17);
    setTimeout(() => { if (rp !== run) return; if (run.k >= evs.length) { frozen = frame({ ...run, k: evs.length, stage: 3 }); rp = null; then(); } else step(); }, wait);
  };
  if (evs[from].seat === HUMAN && !evs[from].skip) step(); else { draw(); setTimeout(step, PACE.move); }
}

// After a move: play back what changed between the table as it was (`old`) and the server's answer (`now`).
function playBack(old, now) {
  if (now.history.length > old.history.length) {   // the move ended a hand: finish it, then its result screen shows
    const s = now.history[old.history.length];
    return replay({ dealer: s.dealer, out: s.out, bids: s.bids, tricks: s.tricks, trick: [], pitcher: s.pitcher, bid: s.bid }, old.hand, progress(old), old, draw);
  }
  replay(now, old.hand, progress(old), now, draw);
}
const playFromStart = () => { const v = T.view; if (!v.over) replay(v, v.hand, 0, v, draw); else draw(); };

// The moves of the hand on screen, as chat lines ("tiltproof: passes"). The table shows the newest FEED of them in its corner,
// like a stream's chat: a new line slides in from below, the older ones slide up, and the oldest fades out.
const FEED = 7;
let fed = 0;   // how many lines the feed held the last time the table was drawn
const cardTxt = (c) => `<span class="ct${RED[suitOf(c)] ? " r" : ""}">${rk(c)}${SUIT[suitOf(c)]}</span>`;
function moveLines(v) {
  const nm = (s) => `${pfp(s)} ${tag(s)}`;
  // The words vary move to move, picked from the move's place in the hand (so a replay or reload chats the same). Of your own moves
  // only the cards you play are in the chat, as just the card.
  const spin = (i, s, salt) => [...`${v.no}|${i}|${s}|${salt}`].reduce((x, c) => (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0, 7) >>> 3;
  const WORDS = {
    play: ["slaps down", "drops", "serves"],
    lead: ["leads", "starts", "opens"],
    win: ["takes hand", "takes it", "gets it", "W"],
    pass: ["passes", "nope", "hmm...next"],
    bid: ["bids", "goes"],
    have: ["gets their", "gets", "bids"],
  };
  const SAID = new Set(["nope", "hmm...next"]);
  const REACT = { big: ["nr", "nt", "oof", "rip", "ez", "💀", "😭", "🔥", "😬"], plain: ["nr", "nt", "gg", "lol", "hm", "👀", "🫡", "😮"] };   // what the chatters say about a trick
  const word = (kind, i, s) => WORDS[kind][spin(i, s, kind) % WORDS[kind].length];
  const card = (kind, i, p) => (p.seat === HUMAN || spin(i, p.seat, "bare") % 10 < 6 ? cardTxt(p.card) : `${word(kind, i, p.seat)} ${cardTxt(p.card)}`);   // most of the time just the card
  const E = [];   // [seat, text, index of the move it belongs to, is it a follow-up (0 the move, 1 a follow-up, 2 a chatter's reaction), is it said or played, a card or a spoken pass (those read "name: card", the rest "name folds")]
  v.bids.forEach((b, j) => {
    const said = !b.forced && !b.bid && SAID.has(word("pass", E.length, b.seat));   // "nope" and "hmm...next" are said, "passes" and "folds" are done
    E.push([b.seat, b.forced ? "stuck 2" : b.bid ? `${word("bid", E.length, b.seat)} ${b.bid}` : word("pass", E.length, b.seat), j, false, said]);
  });
  if (v.pitcher !== null && !v.bids.find((b) => b.seat === v.pitcher).forced) E.push([v.pitcher, `${word("have", E.length, v.pitcher)} ${v.bid}`, v.bids.length - 1, 1, false]);
  let first = true, mv = v.bids.length;
  for (const t of [...v.tricks, { plays: v.trick, winner: null }]) {
    for (const p of t.plays) { E.push([p.seat, card(first ? "lead" : "play", E.length, p), mv++, false, true]); first = false; }
    if (t.winner !== null) {
      E.push([t.winner, word("win", E.length, t.winner), mv - 1, 1, false]);
      // The chatters comment on the trick: a ten or the trump jack in it gets a reaction most of the time, any other trick now and then.
      const big = t.plays.some((p) => rankOf(p.card) === 10 || (suitOf(p.card) === v.trump && rankOf(p.card) === 11));
      if (spin(E.length, 9, "react") % 100 < (big ? 70 : 25)) {
        const pool = REACT[big ? "big" : "plain"];
        E.push([1 + (spin(E.length, 7, "who") % 3), pool[spin(E.length, 5, "what") % pool.length], mv - 1, 2, true]);
      }
    }
  }
  // Now and then a bot posts just an emoji after its move. Which moves and which emoji come from the move's place in the hand, so a replay or reload chats the same.
  const EMOTE = [["😴", "🥱", "💤", "🫠"], ["🗿", "😐", "💀", "🔥"], ["😤", "🥶", "🤬", "🧊"], ["🙂", "😶", "👍", "🤷"]];   // by personality: safe, bold, crowd, none
  const mood = (s, i) => { const h = [...`${v.no}|${i}|${s}`].reduce((x, c) => (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0, 7); return h % 8 === 0 ? EMOTE[v.cast[s].persona ?? 3][(h >> 4) % 4] : null; };
  return E.flatMap(([s, text, ev, late, played], i) => {
    if (s === HUMAN && !played) return [];   // your cards are in the chat; your bids and the lines after them aren't
    const held = ev === v.hold, shown = !held || late < v.stage;   // while a move is the newest on a replaying table, its lines wait for their stage
    const e = s !== HUMAN && !late && (!held || v.stage > 1) && mood(s, i);   // a bot's own emoji follows its move, not the lines that follow a trick
    return [...(shown ? [`${nm(s)}${played ? ":" : ""} ${text}`] : []), ...(shown && e ? [`${nm(s)}: ${e}`] : [])];
  });
}

// The feed's HTML: the newest FEED lines. `fresh` is how many lines this draw added, which only happens while moves play out;
// the page animates those in `chat`. The lines dim towards the top (style.css) but none ever fades away: a line stays until a newer one pushes it off.
function feedHtml(v) {
  // The chat carries on from round to round: the lines of the rounds before this one come first.
  const past = T.view.history.filter((h) => h.no < v.no).flatMap((h) => moveLines({ ...h, trick: [], cast: T.view.cast, hold: null }));
  const L = [...past, ...moveLines(v)], fresh = rp ? L.length - (L.length >= fed ? fed : 0) : 0;
  fed = L.length;
  return `<div class="feed" aria-live="polite" data-fresh="${fresh}">${L.slice(-FEED).map((l) => `<div>${l}</div>`).join("")}</div>`;
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
  const sub = T ? `${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · Game #${T.game} · ${T.view.over ? "Final" : "Round " + ((!rp && pending() ? T.view.history[seen].no : T.view.no) + 1)}` : "";   // today's date on this device
  const right = mode === "account" ? `<span class="row" style="gap:14px"><button class="link" data-k="esc">Back</button><a class="link" href="ledger.html">Ledger</a></span>`
    : `<span class="row" style="gap:14px"><a class="link" href="ledger.html">Ledger</a><button class="link" data-k="a">Account</button></span>`;
  return `<header><div class="title">NANO PITCH<small>${esc(sub)}</small></div>${right}</header>`;
}

function loadingScreen() { return header() + `<div class="panel"><p class="hint">${esc(msg || "Dealing…")}</p></div>`; }

// You and the table's three hands, with the running totals and, under each score, how close that hand is to 11.
function scoreboard(v) {
  const top = Math.max(...v.totals);
  const cell = (seat) => {
    const t = v.totals[seat], pct = Math.min(t < 0 ? 120 : 100, (100 * Math.abs(t)) / v.target);   // below zero the bar runs left, out of its frame
    return `<div class="score${seat === HUMAN ? " you" : ""}${v.totals[seat] === top && top > 0 ? " lead" : ""}">
      <div class="em">${pfp(seat)}</div><div class="nm">${seat === HUMAN && myName ? `<span class="tag">${esc(myName)}</span>` : tag(seat)}</div><div class="pt">${t}</div><div class="bar${t < 0 ? " neg" : ""}"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
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
  const top = v.bids.reduce((a, x) => (x.bid > a.bid ? x : a), { bid: 0 }).seat;   // while bidding, the highest bid so far; once it's over, the bidder
  const hot = seat === (v.pitcher ?? top) ? " hot" : "";   // the bid that holds the table is always lit
  if (b.forced) return `<span class="chip${hot}">stuck 2${suit}</span>`;
  return b.bid ? `<span class="chip${hot}">bid ${b.bid}${suit ? " in" + suit : ""}</span>` : `<span class="small">pass</span>`;
}

// The trick on the table: the current one, or, while moves play out, the last finished one (with its winner lit).
function tableTrick(v) {
  if (v.trick.length) return { plays: v.trick, done: false };
  if (!rp && !(frozen && pending())) return { plays: [], done: false };   // the pause is over: the table is clear for the next lead
  const last = v.tricks[v.tricks.length - 1];
  return last ? { plays: last.plays, done: true, winner: last.winner } : { plays: [], done: false };
}

function gameScreen() {
  const popup = !rp && pending();   // a finished round's summary shows over the table
  const v = rp ? frame(rp) : popup && frozen ? frozen : T.view;
  if (!rp && !popup && T.view.over) return finalScreen();
  const tt = tableTrick(v);
  const played = (seat, cls) => {
    const p = tt.plays.find((x) => x.seat === seat);
    return p ? `<div class="${cls}">${card(p.card, tt.done ? (tt.winner === seat ? "win" : "dim") : "")}</div>` : "";
  };
  const dealer = (seat) => (v.dealer === seat ? '<span class="d">D</span>' : "");
  const spot = (seat, cls) => `<div class="seat ${cls}${v.turn === seat ? " turn" : ""}">
      <div class="nm">${pfp(seat)} ${tag(seat)}${dealer(seat)}</div>${backs(v.counts[seat], v.out && v.out[seat])}<div class="bid">${bidText(v, seat)}</div></div>`;
  const ARROW = ["⬇️", "⬅️", "⬆️", "➡️"];   // by seat: you below, West left, North above, East right
  const face = v.turn === null ? "" : v.out && v.out[v.turn] && v.phase === "play" ? "💤" : ARROW[v.turn];   // the arrow points at whose move it is; a seat sitting out gets 💤; nobody's turn shows nothing
  const middle = tt.plays.length || !face ? "" : `<div class="mid"><span class="bot">${face}</span>${v.phase === "bid" ? "<br>bidding" : ""}</div>`;

  const legal = new Set(v.legal || []), canPlay = !rp && v.phase === "play" && v.turn === HUMAN, bidTurn = !rp && v.phase === "bid" && v.turn === HUMAN;
  const hand = v.hand.length ? v.hand.map((c) => (canPlay && legal.has(c) ? card(c, "ok", "c" + c) : card(c, canPlay ? "no" : bidTurn ? "dim" : ""))).join("")
    : '<div class="pc blank" aria-hidden="true"></div>'.repeat(6);   // no cards left: invisible ones hold the row open at the size of a hand

  let bidding = "";
  if (!rp && v.phase === "bid" && v.turn === HUMAN) {
    const lit = v.bidOptions.includes(hotBid) ? hotBid : 0;
    bidding = `<div class="bids">${[0, 2, 3, 4].map((b) => `<button data-k="b${b}" class="${b === lit ? "hot" : ""}" ${v.bidOptions.includes(b) ? "" : "disabled"}>${b ? b : "Pass"}</button>`).join("")}</div>`;
  }


  return header() + scoreboard(popup ? T.view : v) + `
    <div class="panel table">
      ${feedHtml(v)}
      ${spot(2, "n")}${spot(1, "w")}
      <div class="center">${played(2, "tn")}${played(1, "tw")}${middle}${played(3, "te")}${played(0, "ts")}</div>
      ${spot(3, "e")}
      ${bidding}
      <div class="seat s${v.turn === HUMAN ? " turn" : ""}"><div class="nm">${pfp(0)} ${myName ? `<span class="tag">${esc(myName)}</span>` : tag(0)}${dealer(0)}</div><div class="bid">${bidText(v, 0)}</div></div>
      <div class="hand">${hand}${v.out && v.out[0] ? SAT : ""}</div>
      ${popup ? `<div class="popup">${handPopup(T.view.history[seen])}</div>` : ""}
    </div>
    ${msg && !rp ? `<p class="msg">${esc(msg)}</p>` : ""}`;
}

// ---------- the result of a hand, and of the game ----------

function handPopup(h) {
  const v = T.view, last = h.no === v.history.length - 1;
  const row = (label, value) => `<div class="kv"><span>${label}</span><span>${value}</span></div>`;
  const delta = (n) => `<span class="${n > 0 ? "up" : n < 0 ? "down" : "small"}">${signed(n)}</span>`;
  return `
    <div class="panel handover">
      <div class="big" style="font-size:24px">GAME ${T.game}, ROUND ${h.no + 1}: ${h.made ? "MADE IT!" : "SET!"}</div>
      <p class="hint" style="margin:0">${tag(h.pitcher)} bid ${h.bid} in ${suitIcon(h.trump)} and ${h.made ? "made it!" : "got SET!"}</p>
      <div class="rows">
        ${row(`${ICON.high} High`, `${who(h.high.seat)} ${card(h.high.card, "mini")}`)}
        ${row(`${ICON.low} Low`, `${who(h.low.seat)} <span class="small">played</span> ${card(h.low.card, "mini")}`)}
        ${row(`${ICON.jack} Jack`, h.jack ? `${who(h.jack.seat)} ${card(h.jack.card, "mini")}` : `<span class="small">not in play</span>`)}
        ${row(`${ICON.game} Game`, h.gameWinner === null ? `<span class="small">tied: nobody</span>` : `${who(h.gameWinner)} <span class="small">${h.gameTotals[h.gameWinner]} card points</span>`)}
        ${row(`${ICON.bid} Bid`, `${who(h.pitcher)} bid ${h.bid}: ${h.made ? `<b class="up">made it</b>` : `<b class="down">set ${-h.bid}</b>`}`)}
        ${row("This round", [0, 1, 2, 3].map((s) => `${tag(s)} ${delta(h.final[s])}`).join(" "))}
      </div>
      <button class="go" data-k="go">${last && v.over ? "See the result" : "Next round"}</button>
    </div>`;
}

function finalScreen() {
  const v = T.view, f = T.field, place = v.place;
  const winner = v.totals.indexOf(Math.max(...v.totals));
  const headline = `${esc(nameOf(winner).toUpperCase())} WINS`;
  const sub = place === 1 ? `first to ${v.target} in ${v.history.length} rounds` : `${tag(winner)} got there first · you placed ${ORD[place]}`;
  const finals = v.history.map((h) => { const n = h.final[HUMAN]; return `<span class="chip ${n > 0 ? "up" : n < 0 ? "down" : ""}">${signed(n)}</span>`; }).join("");
  let field = "";
  if (f && f.games > 0) {
    const won = Math.round((100 * f.places[0]) / f.games);
    field = `<div class="panel">
      <div class="kv"><span>The field</span><span>${f.games} player${f.games === 1 ? "" : "s"} finished this game</span></div>
      <div class="kv"><span>Beat the table</span><span>${f.games === 1 ? "you're the first to finish it" : `${won}% of players`}</span></div>
      <div class="kv"><span>Average game</span><span>${(f.hands / f.games).toFixed(1)} rounds</span></div></div>`;
  }
  // The table's memory at work: how many of the bots' bids this game went with what the table remembered.
  const botBids = v.history.flatMap((h) => h.bids.filter((b) => b.seat !== HUMAN && !b.forced));
  const followed = [1, 2, 3].map((s) => ({ s, n: botBids.filter((b) => b.seat === s && b.crowd).length })).filter((x) => x.n);
  const memory = `<div class="panel"><div class="kv"><span>The table's memory</span><span>${botBids.filter((b) => b.crowd).length} of ${botBids.length} bot bids went with the crowd</span></div>
      ${followed.length ? `<div class="small">${followed.map((x) => `${tag(x.s)} ${x.n}`).join(" · ")}</div>` : `<div class="small">The table hasn't seen enough rounds like these yet.</div>`}</div>`;
  const buttons = `<button class="go" data-k="play">Play</button>`;
  return header() + `
    <div class="panel"><div class="big">${headline}</div><p class="hint" style="margin:6px 0 0">${sub}</p></div>
    ${scoreboard(v)}
    <div class="panel"><div class="small" style="margin-bottom:8px">Your score each round</div><div class="hands">${finals}</div></div>
    ${field}
    ${memory}
    ${msg ? `<p class="msg">${esc(msg)}</p>` : ""}
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
      ${a.player ? `<p class="small" style="margin:6px 0 0">Tap your pic for a new one.</p>` : ""}
      <p class="small">${!a.player ? "No player here yet: play a card, or log in below."
        : a.codes.length || a.passkeys.length ? `<b class="up">Logged in</b> on ${a.devices} device${a.devices === 1 ? "" : "s"}.`
        : `<b>Guest:</b> no save code or passkey yet, so this player lives only in this browser.`}
        A save code or passkey brings your game to another device.</p>
      ${a.player ? `<div class="row" style="margin-bottom:12px"><button class="ghost" style="flex:1" data-k="name">Reroll name</button><button class="ghost" style="flex:1" data-k="out">Log out</button></div>` : ""}
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
  api("account").then((a) => { if (a && ((a.pfp && a.pfp !== myPfp) || (a.name && a.name !== myName))) { if (a.pfp) myPfp = a.pfp; if (a.name) myName = a.name; if (mode === "game") draw(); } });   // the player's own pic and name, when they have them
  const r = await api("game");
  if (r.error) { msg = r.error; mode = "loading"; return draw(); }
  T = r;
  msg = "";
  mode = "game"; seen = T.view.history.length;   // a game reloaded in progress doesn't replay old results
  rp = null;
  if (T.n === 0) playFromStart();   // a new game: the bids before yours play out
  else draw();
}

async function play() {
  if (busy) return;
  busy = true; msg = ""; draw();
  const r = await api("play", {});
  busy = false;
  if (r.error) { msg = r.error; return draw(); }
  T = { game: r.game, n: r.n, view: r.view, field: r.field }; seen = T.view.history.length; playFromStart();
}

async function send(action) {
  if (busy || !T) return;
  hotBid = 0;
  busy = true; msg = ""; draw();
  const r = await api("act", { game: T.game, n: T.n, action });
  busy = false;
  const old = T.view;
  if (r.view) T = { game: r.game, n: r.n, view: r.view, field: r.field };   // a refused move still brings the game as it is
  if (r.error) msg = r.error;
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
  myPfp = r.pfp; await openAccount("");
}
async function openAccount(m = "") { acctMsg = m; acct = await api("account"); if (acct.pfp) myPfp = acct.pfp; if (acct.name) myName = acct.name; mode = "account"; draw(); }
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
  async pfp() { const others = PFP_POOL.filter((e) => e !== myPfp); await pickPfp(others[Math.floor(Math.random() * others.length)]); },   // a random new pic each tap
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
  async esc() { mode = "game"; newCode = null; draw(); },
};

// ---------- input: taps and keys do the same things ----------

function press(k) {
  if (mode === "account") { const f = ACCOUNT_KEYS[k]; if (f) f(); return; }
  if (mode !== "game" || !T) return;
  if (k === "a") return openAccount();
  if (rp) return;   // moves are playing out
  const v = T.view;
  if (k === "go") { if (pending()) { seen = v.history.length; msg = ""; playFromStart(); } return; }
  if (k === "play" && v.over) return play();
  if (pending()) return;   // the result of a hand is on screen: moves wait until it's dismissed
  if (k[0] === "b" && v.phase === "bid") return send({ type: "bid", bid: Number(k.slice(1)) });
  if (k[0] === "c" && v.phase === "play") return send({ type: "play", card: Number(k.slice(1)) });
}

// The lit bid follows the mouse and stays where it left (a redraw keeps it too, through hotBid).
$app.addEventListener("mouseover", (e) => {
  const b = e.target.closest(".bids button:not(:disabled)");
  if (!b) return;
  hotBid = Number(b.dataset.k.slice(1));
  for (const x of b.parentElement.children) x.classList.toggle("hot", x === b);
});

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
  if (v.over) { if (key === "p") press("play"); return; }
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

load().then(() => { if (location.hash === "#account") { history.replaceState(null, "", location.pathname); openAccount(); } });   // the ledger page's Account link
