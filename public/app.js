// Nano Pitch page: you against the table. The table is one robot that plays the other three hands, each with a gen-z name
// (aura-farm's lists) that the game's seed picks (left, top, right); a game is first to 11 points over as many hands as it takes,
// and games are numbered: everyone plays 1, 2, 3... in order. The look follows aura-farm:
// dark, purple glow, rounded panels. Everything is drawn into #app from the last answer of /api/game, /api/play or /api/act.
import { VERSION } from "./version.js";
import { suitOf, rankOf, gamePoints, HUMAN, PFP_POOL, gamerTag } from "./engine/pitch.js";

const SUIT = ["♣", "♦", "♥", "♠"];
const RED = [false, true, true, false];
const RANK = { 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };
const ORD = ["", "1st", "2nd", "3rd", "4th"];
const ICON = { table: "🤖", high: "👑", low: "🪶", jack: "🃏", game: "🎯", bid: "🔥" };

const $app = document.getElementById("app");

let T = null;          // the last answer: { game, daily, day, n, view, field, next }
let mode = "loading";  // loading | game | account
let busy = false;
let seen = 0;          // how many finished hands the player has been shown the result of
let msg = "";
let acct = null, newCode = null, acctMsg = "";
let hotBid = 0;        // the bid lit on the bid panel: Pass at first, then the last one the mouse was on, until you bid
let hotCard = "";      // the card the mouse is on ("c" + card), so a redraw gives it back already lifted instead of dropping it for a moment
let preview = null;   // a guest's name: the server rolls and signs one ({ name, sig }), the page keeps it, and it is sent back only with a save code or passkey
let myName = "";      // the player's own name, shown on their seat (empty until the server has one: the seat says "You")
let myPfp = "😎";      // the player's own profile pic (kept on the server; 😎 until they roll one)

// ---------- small helpers ----------

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rk = (c) => RANK[rankOf(c)] || String(rankOf(c));
const signed = (n) => (n > 0 ? "+" + n : String(n));
// Seats in play order: you, then the table's three hands clockwise. Their names and profile pics come with the game (view.cast).
const pfp = (seat) => (seat === HUMAN ? myPfp : seat >= VIEWER ? viewers()[seat - VIEWER].pfp : T.view.cast[seat].pfp);
// The chat's other voices: names that are not at the table, only watching, who comment on the game. Seats VIEWER to VIEWER + 5 stand for
// them in the chat. A game has the same six every time (drawn from its number, with names from the same lists as the bots), none
// sharing a name with the table or with you. They are made up: no player is ever one of them.
const VIEWER = 4, VIEWERS = 6;
let viewed = null;
function viewers() {
  const key = `${T.daily ? "d" : "g"}${T.game}|${myName}|${[1, 2, 3].map((x) => T.view.cast[x].name).join()}`;
  if (viewed && viewed.key === key) return viewed.list;
  const list = [], taken = (n) => [myName, ...[1, 2, 3].map((x) => T.view.cast[x].name), ...list.map((v) => v.name)].some((x) => x && x.toLowerCase() === n.toLowerCase());
  for (let k = 0; k < VIEWERS; k++) {
    let h = [...`${T.daily ? "d" : "g"}${T.game}|viewer${k}`].reduce((x, c) => (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0, 7), name = "";
    for (let i = 0; i < 50 && (!name || taken(name)); i++) { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; name = gamerTag(() => h / 4294967296); }
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    list.push({ name, pfp: PFP_POOL[h % PFP_POOL.length] });
  }
  viewed = { key, list };
  return list;
}

// A bot's name. If it is the player's own name, the bot gets another (the same one every time for that game and seat), so no two seats share a name.
function botName(seat) {
  const name = T.view.cast[seat].name, taken = (n) => [myName, ...[1, 2, 3].map((s) => T.view.cast[s].name)].some((x) => x && x.toLowerCase() === n.toLowerCase());
  if (!myName || name.toLowerCase() !== myName.toLowerCase()) return name;
  let h = [...`${T.daily ? "d" : "g"}${T.game}|${seat}`].reduce((x, c) => (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0, 7);
  for (let i = 0; i < 50; i++) { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; const alt = gamerTag(() => h / 4294967296); if (!taken(alt)) return alt; }
  return name;
}
const tag = (seat) => (seat === HUMAN ? `<b>You</b>` : seat >= VIEWER ? `<span class="tag v">${esc(viewers()[seat - VIEWER].name)}</span>` : `<span class="tag s${seat}">${esc(botName(seat))}</span>`);   // a hand's name, in its seat's colour
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
// everything that isn't the hand's moves (totals, hand number, dealer). After the last move the turn stays where the live hand has it (yours),
// so it doesn't blink off and back; a finished hand's summary has no turn, so nobody has it.
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
    made: k >= evs.length ? h.made : undefined,   // how the round ended, known once its last move is shown (the chat reacts to it)
    pitcher: settled ? h.pitcher : null, bid: settled ? h.bid : 0, trump: cards.length ? suitOf(cards[0].card) : null,
    turn: k < evs.length ? evs[k].seat : (h.turn ?? null), legal: null, bidOptions: null,
    hold: stage < 3 && k > 0 && !evs[k - 1].skip ? evs.slice(0, k).filter((e) => !e.skip).length - 1 : null, stage,   // the chat holds back the newest move's lines in turn: the move itself at stage 1, its follow-ups (its emoji, who took the trick, who has the bid) at stage 2, the chatters' reactions at stage 3
  };
}

// The chat keeps going while a finished round's card is up: one more line (see moveLines, `after`) every second or so, until the
// card is closed.
function chatOn() {
  afterN = 0;
  const mine = ++afterRun;
  if (!pending()) return;
  for (let n = 1; n <= 64; n++) setTimeout(() => { if (afterRun === mine && !rp && pending()) { afterN = n; liveChat = true; draw(); liveChat = false; } }, n <= 4 ? 1000 * n + ((n * 370) % 500) : 4000 + (n - 4) * 3500 + ((n * 370) % 900));
}

// While it is your turn the chat goes on too: a viewer says something every few seconds until you move. `idleBatches` holds, for each
// hand, one batch for each time the turn came to you: { k: how many moves had been made, n: how many lines were said }.
const idleBatches = new Map();
const idleKey = (v) => `${T.game}|${T.daily ? "d" : "n"}|${v.no}`;
const moveCount = (v) => v.bids.length + v.tricks.reduce((n, t) => n + t.plays.length, 0) + v.trick.length;
const IDLE = {
  bid: ["you got this", "good luck", "ooh", "take your time", "👀", "hmm", "🍿", "gl", "nice hand?", "😄"],
  play: ["you got this", "good luck", "ooh", "take your time", "big brain time", "that's the one", "👀", "🍿", "trump it", "hmm", "nice", "😄"],
};
function idleStep() {
  if (mode !== "game" || !T || busy || rp || pending() || T.view.over || T.view.turn !== HUMAN) return;
  const key = idleKey(T.view), k = moveCount(T.view), list = idleBatches.get(key) || [];
  let b = list[list.length - 1];
  if (!b || b.k !== k) { b = { k, n: 0 }; list.push(b); idleBatches.set(key, list); }
  if (b.n >= 400) return;
  b.n++; liveChat = true;
  const feed = document.querySelector(".feed");
  if (feed) { feed.outerHTML = feedHtml(T.view); chat(); } else draw();   // only the chat is redrawn, so a click on a card is never lost to it
  liveChat = false;
}
const idleTick = () => setTimeout(() => { idleStep(); idleTick(); }, 3200 + Math.random() * 3000);
idleTick();

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
    setTimeout(() => { if (rp !== run) return; if (run.k >= evs.length) { frozen = frame({ ...run, k: evs.length, stage: 3 }); rp = null; then(); chatOn(); } else step(); }, wait);
  };
  if (evs[from].seat === HUMAN && !evs[from].skip) step(); else { draw(); setTimeout(step, PACE.move); }
}

// After a move: play back what changed between the table as it was (`old`) and the server's answer (`now`).
function playBack(old, now) {
  if (now.history.length > old.history.length) {   // the move ended a hand: finish it, then its result screen shows
    const s = now.history[old.history.length];
    return replay({ dealer: s.dealer, out: s.out, bids: s.bids, tricks: s.tricks, trick: [], pitcher: s.pitcher, bid: s.bid, made: s.made }, old.hand, progress(old), old, draw);
  }
  replay(now, old.hand, progress(old), now, draw);
}
const playFromStart = () => { const v = T.view; if (!v.over) replay(v, v.hand, 0, v, draw); else draw(); };

// The moves of the hand on screen, as chat lines ("tiltproof: passes"). The table shows the newest FEED of them in its corner,
// like a stream's chat: a new line slides in from below, the older ones slide up, and the oldest fades out.
const FEED = 7;
let fed = 0;   // how many lines the feed held the last time the table was drawn
let afterN = 0, afterRun = 0, liveChat = false;   // while a round's card is up: how many of the chat's lines after the round have come, which card they belong to, and whether this draw adds one
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
  const REACT = { big: ["nr", "nt", "oof", "💀", "😭", "🔥", "😬"], plain: ["nr", "nt", "gg", "lol", "hm", "👀", "🫡", "😮"] };   // what the chatters say about a trick
  // What the bots say about the bidding and about how a round ended: someone bidding 4, the bidder making it or getting set.
  const CHIME = { bold: ["bold", "😳", "oh ok", "???", "🫣"], made_self: ["W", "easy", "💪"], set_self: ["oof", "💀", "bruh", "😭"],
    made_other: ["nice", "gg", "ok ok", "👀", "damn"], set_other: ["lol", "😬", "oof"],
    then: ["fr", "ngl", "real", "lmao", "true", "clean", "classic", "bruh", "ok next"] };   // what the viewers add while the round's card is up
  const chatter = (i) => VIEWER + (spin(i, 3, "who") % VIEWERS);   // one of the viewers, who comment on what the table does
  const chime = (kind, i) => CHIME[kind][spin(i, 6, kind) % CHIME[kind].length];
  const word = (kind, i, s) => WORDS[kind][spin(i, s, kind) % WORDS[kind].length];
  const card = (kind, i, p) => (p.seat === HUMAN || spin(i, p.seat, "bare") % 10 < 6 ? cardTxt(p.card) : `${word(kind, i, p.seat)} ${cardTxt(p.card)}`);   // most of the time just the card
  // On a bot's turn a viewer says one of the friendly turn lines (IDLE) after its move. Flagged like the idle lines (seventh item) so a bot's emoji stays on the same moves; never the same words twice in a row.
  let lastTurn = -1;
  const turnLine = (pool, ev) => {
    let w = spin(E.length, 4, "turn") % pool.length;
    if (w === lastTurn) w = (w + 1) % pool.length;
    lastTurn = w;
    return [chatter(E.length), pool[w], ev, 2, true, 0, true];
  };
  const E = [];   // [seat, text, index of the move it belongs to, is it a follow-up (0 the move, 1 a follow-up, 2 a chatter's reaction), is it said or played, a card or a spoken pass (those read "name: card", the rest "name folds")]
  v.bids.forEach((b, j) => {
    const said = !b.forced && !b.bid && SAID.has(word("pass", E.length, b.seat));   // "nope" and "hmm...next" are said, "passes" and "folds" are done
    E.push([b.seat, b.forced ? "stuck 2" : b.bid ? `${word("bid", E.length, b.seat)} ${b.bid}` : word("pass", E.length, b.seat), j, false, said]);
    if (b.bid === 4 && spin(E.length, 8, "bold") % 100 < 60) E.push([chatter(E.length), chime("bold", E.length), j, 2, true]);   // a 4 gets a reaction most of the time
    if (b.seat !== HUMAN) E.push(turnLine(IDLE.bid, j));
  });
  if (v.pitcher !== null && !v.bids.find((b) => b.seat === v.pitcher).forced) E.push([v.pitcher, `${word("have", E.length, v.pitcher)} ${v.bid}`, v.bids.length - 1, 1, false]);
  let first = true, mv = v.bids.length;
  for (const t of [...v.tricks, { plays: v.trick, winner: null }]) {
    for (const p of t.plays) { E.push([p.seat, card(first ? "lead" : "play", E.length, p), mv++, false, true]); first = false; if (p.seat !== HUMAN) E.push(turnLine(IDLE.play, mv - 1)); }
    if (t.winner !== null) {
      E.push([t.winner, word("win", E.length, t.winner), mv - 1, 1, false]);
      // The viewers comment on the trick: a ten or the trump jack in it gets a reaction most of the time, any other trick now and then.
      const big = t.plays.some((p) => rankOf(p.card) === 10 || (suitOf(p.card) === v.trump && rankOf(p.card) === 11));
      if (spin(E.length, 9, "react") % 100 < (big ? 70 : 40)) {
        const pool = REACT[big ? "big" : "plain"];
        E.push([chatter(E.length), pool[spin(E.length, 5, "what") % pool.length], mv - 1, 2, true]);
      }
    }
  }
  // How the round ended, once its last move is shown. These lines (post 1, 2, 3...) come one at a time while the round's card is up
  // (`after` is how many have come), so the chat keeps going under it: the bidder, the viewers, then a follow-up or two.
  if (typeof v.made === "boolean" && v.pitcher !== null) {
    const last = mv - 1, kind = v.made ? "made" : "set", roll = (n) => spin(E.length, n, "end") % 100;
    let post = 0;
    if (v.pitcher !== HUMAN) {
      if (roll(11) < 65) E.push([v.pitcher, chime(kind + "_self", E.length), last, 2, true, ++post]);
      if (roll(12) < (v.made ? 35 : 55)) E.push([chatter(E.length), chime(kind + "_other", E.length), last, 2, true, ++post]);
    } else if (roll(13) < 70) E.push([chatter(E.length), chime(kind + "_other", E.length), last, 2, true, ++post]);
    if (roll(14) < 60) E.push([chatter(E.length), chime("then", E.length), last, 2, true, ++post]);
    if (roll(15) < 35) E.push([chatter(E.length), chime("then", E.length), last, 2, true, ++post]);
    if (v.after !== Infinity) for (let n = 0; n < 60; n++) E.push([chatter(E.length), chime("then", E.length), last, 2, true, ++post]);   // and it goes on while the card is up (chatOn); the rounds before this one only keep what was said
  }
  // While it is your turn the chat never goes quiet: the viewers keep talking (idleStep adds a line every few seconds, one batch for each
  // time the turn came to you). A batch stays where it was said, after the move it waited on, so it doesn't jump when you move.
  for (const b of idleBatches.get(idleKey(v)) || []) {
    if (moveCount(v) < b.k) continue;
    const pool = b.k < 4 ? IDLE.bid : IDLE.play, at = E.reduce((m, e, i) => (e[2] <= b.k - 1 && !e[6] ? i : m), -1);
    const mix = (a) => { let h = Math.imul(a ^ 0x9e3779b9, 2654435761); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return h >>> 0; };   // the same numbers every draw, spread well
    let prev = -1;
    const lines = Array.from({ length: b.n }, (_, j) => {
      const r = (b.k + 1) * 1000 + j, who = mix(r) % VIEWERS;
      let w = mix(r + 7919) % pool.length;
      if (w === prev) w = (w + 1) % pool.length;   // never the same words twice in a row
      prev = w;
      return [VIEWER + who, pool[w], b.k - 1, 2, true, 0, true];
    });
    E.splice(at + 1, 0, ...lines);
  }
  // Now and then a bot posts just an emoji after its move. Which moves and which emoji come from the move's place in the hand, so a replay or reload chats the same.
  const EMOTE = [["😴", "🥱", "💤", "🫠"], ["🗿", "😐", "💀", "🔥"], ["😤", "🥶", "🤬", "🧊"], ["🙂", "😶", "👍", "🤷"]];   // by personality: safe, bold, crowd, none
  const mood = (s, i) => { const h = [...`${v.no}|${i}|${s}`].reduce((x, c) => (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0, 7); return h % 6 === 0 ? EMOTE[v.cast[s].persona ?? 3][(h >> 4) % 4] : null; };
  return E.flatMap(([s, text, ev, late, played, post], i) => {
    const oi = E.slice(0, i).filter((x) => !x[6]).length;   // the entry's place without the idle lines, so a bot's emoji stays on the same moves
    if (s === HUMAN && !played) return [];   // your cards are in the chat; your bids and the lines after them aren't
    const held = ev === v.hold, shown = (!held || late < v.stage) && (!post || (v.after ?? 0) >= post);   // while a move is the newest on a replaying table, its lines wait for their stage
    const e = s !== HUMAN && !late && (!held || v.stage > 1) && mood(s, oi);   // a bot's own emoji follows its move, not the lines that follow a trick
    return [...(shown ? [`${nm(s)}${played ? ":" : ""} ${text}`] : []), ...(shown && e ? [`${nm(s)}: ${e}`] : [])];
  });
}

// The feed's HTML: the newest FEED lines. `fresh` is how many lines this draw added, which only happens while moves play out;
// the page animates those in `chat`. The lines dim towards the top (style.css) but none ever fades away: a line stays until a newer one pushes it off.
function feedHtml(v) {
  // The chat carries on from round to round: the lines of the rounds before this one come first.
  const past = T.view.history.filter((h) => h.no < v.no).flatMap((h) => moveLines({ ...h, trick: [], cast: T.view.cast, hold: null, after: Infinity }));
  const L = [...past, ...moveLines({ ...v, after: afterN })], fresh = rp || liveChat ? L.length - (L.length >= fed ? fed : 0) : 0;
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
  fitGrid();
  chat();
}

// The rounds grid shows whole rounds only: its window is as wide as the two left columns plus as many whole round columns as fit
// (rounds snap into place when you scroll), so no round is ever cut in half at the right edge. With room for all of them it is left alone.
function fitGrid() {
  const s = document.querySelector(".rscroll");
  if (!s) return;
  s.style.maxWidth = "";
  const rounds = Number(s.firstElementChild.style.getPropertyValue("--rounds")), room = Math.floor((s.parentElement.clientWidth - GRID_LEFT) / GRID_COL);
  if (rounds > room && room > 0) s.style.maxWidth = room * GRID_COL + "px";
}
const GRID_LEFT = 64, GRID_COL = 44;   // the width of the grid's two left columns, and of each round's column (style.css, .rgrid)
addEventListener("resize", () => fitGrid());

function header() {
  const sub = T ? `${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${gameLabel()} · ${T.view.over ? "Final" : "Round " + ((!rp && pending() ? T.view.history[seen].no : T.view.no) + 1)}` : "";   // today's date on this device
  const right = mode === "account" ? `<span class="row" style="gap:14px"><button class="link" data-k="esc">Back</button><a class="link" href="ledger.html">Ledger</a></span>`
    : `<span class="row" style="gap:14px"><a class="link" href="ledger.html">Ledger</a><button class="link" data-k="a">Account</button></span>`;
  return `<header><div class="title">NANO PITCH<small>${esc(sub)}</small></div>${right}</header>`;
}

function loadingScreen() { return header() + `<div class="panel"><p class="hint">${esc(msg || "Dealing…")}</p></div>`; }

// You and the table's three hands, with the running totals and, under each score, how close that hand is to 11.
function scoreboard(v, end = false) {   // `end`: the game's result is showing, so everyone but the winner goes black and white
  const top = Math.max(...v.totals);
  const cell = (seat) => {
    const t = v.totals[seat], pct = Math.min(t < 0 ? 120 : 100, (100 * Math.abs(t)) / v.target);   // below zero the bar runs left, out of its frame
    return `<div class="score${seat === HUMAN ? " you" : ""}${v.totals[seat] === top && top > 0 ? " lead" : ""}${end && v.totals[seat] !== top ? " lost" : ""}">
      <div class="top"><div class="em">${pfp(seat)}</div><div class="pt">${t}</div></div><div class="nm">${seat === HUMAN && myName ? `<span class="tag">${esc(myName)}</span>` : tag(seat)}</div><div class="bar${t < 0 ? " neg" : ""}"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
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

// What each seat has so far this round, from the finished tricks and the one on the table: the High and Low trump (whoever played
// them, the actual cards), the Jack (once its trick is won) and the Game card points in the tricks it has won. Same rules as scoreHand
// in the engine. `cards` is one entry per card (High, Jack, Low, top to bottom), so one card in two roles is drawn once.
function held(v) {
  const H = [0, 1, 2, 3].map(() => ({ cards: [], pts: 0 }));
  if (v.trump === null) return H;
  const give = (seat, c, role) => { const x = H[seat].cards.find((y) => y.c === c); if (x) x.roles += role; else H[seat].cards.push({ c, roles: role }); };
  const trumps = [...v.tricks.flatMap((t) => t.plays), ...v.trick].filter((p) => suitOf(p.card) === v.trump);
  if (trumps.length) {
    const hi = trumps.reduce((a, p) => (rankOf(p.card) > rankOf(a.card) ? p : a)), lo = trumps.reduce((a, p) => (rankOf(p.card) < rankOf(a.card) ? p : a));
    give(hi.seat, hi.card, "👑");
    give(lo.seat, lo.card, "🪶");
  }
  for (const t of v.tricks) for (const p of t.plays) {
    H[t.winner].pts += gamePoints(p.card);
    if (suitOf(p.card) === v.trump && rankOf(p.card) === 11) give(t.winner, p.card, "🃏");
  }
  const rank = { "👑": 0, "🃏": 1, "🪶": 2 };   // top to bottom: High, Jack, Low
  for (const h of H) h.cards.sort((x, y) => Math.min(...[...x.roles].map((r) => rank[r])) - Math.min(...[...y.roles].map((r) => rank[r])));
  return H;
}

function gameScreen() {
  const popup = !rp && pending();   // a finished round's summary shows over the table
  const v = rp ? frame(rp) : popup && frozen ? frozen : T.view;
  if (!rp && !popup && T.view.over) return finalScreen();
  const tt = tableTrick(v);
  const played = (seat, cls) => {
    const p = tt.plays.find((x) => x.seat === seat);
    return p ? `<div class="${cls}">${card(p.card, tt.done && tt.winner === seat ? "win" : "")}</div>` : "";
  };
  const H = held(v), own = (seat, stack) => {   // the cards held, then the Game points; in a column (`stack`) the points come first, which is the bottom
    if (v.trump === null) return "";
    const tiny = H[seat].cards.map((x) => card(x.c, "tiny")), cards = (stack ? tiny.reverse() : tiny).join(""), pts = H[seat].pts ? `<span class="gp">${H[seat].pts}</span>` : "";   // no Game points yet: no number card
    if (!cards && !pts) return "";
    return `<div class="own">${stack ? pts + cards : cards + pts}</div>`;
  };
  const dealer = (seat) => (v.dealer === seat ? '<span class="d">D</span>' : "");
  const spot = (seat, cls) => {   // N, W and E: the held cards stand in a column beside the hand (left of it, but right of it for E), starting at the bottom
    const bk = backs(v.counts[seat], v.out && v.out[seat]), col = own(seat, true), side = cls === "e" ? bk + col : col + bk;
    return `<div class="seat ${cls}${v.turn === seat ? " turn" : ""}${v.out && v.out[seat] ? " out" : ""}">
      <div class="nm">${pfp(seat)} ${tag(seat)}${dealer(seat)}</div><div class="bk">${side}</div><div class="bid">${bidText(v, seat)}</div></div>`;
  };
  const ARROW = ["⬇️", "⬅️", "⬆️", "➡️"];   // by seat: you below, West left, North above, East right
  const face = v.turn === null ? "" : v.out && v.out[v.turn] && v.phase === "play" ? "💤" : ARROW[v.turn];   // the arrow points at whose move it is; a seat sitting out gets 💤; nobody's turn shows nothing
  const middle = tt.plays.length || !face ? "" : `<div class="mid"><span class="bot">${face}</span>${v.phase === "bid" ? "<br>bidding" : ""}</div>`;

  const live = canAct(), lv = rp ? T.view : v;   // in the last pause the table is still a frame, but the server's view knows what you may play
  const legal = new Set(lv.legal || []), canPlay = live && v.phase === "play" && v.turn === HUMAN, bidTurn = live && v.phase === "bid" && v.turn === HUMAN;
  const hand = v.hand.length ? v.hand.map((c) => (canPlay && legal.has(c) ? card(c, "ok" + (hotCard === "c" + c ? " hot" : ""), "c" + c) : card(c, canPlay ? "no" : bidTurn ? "dim" : ""))).join("")
    : '<div class="pc blank" aria-hidden="true"></div>'.repeat(6);   // no cards left: invisible ones hold the row open at the size of a hand

  let bidding = "";
  if (bidTurn) {
    const lit = lv.bidOptions.includes(hotBid) ? hotBid : 0;
    bidding = `<div class="bids">${[0, 2, 3, 4].map((b) => `<button data-k="b${b}" class="${b === lit ? "hot" : ""}" ${lv.bidOptions.includes(b) ? "" : "disabled"}>${b ? b : "Pass"}</button>`).join("")}</div>`;
  }


  return header() + scoreboard(popup ? T.view : v) + `
    <div class="panel table">
      ${feedHtml(v)}
      ${spot(2, "n")}${spot(1, "w")}
      <div class="center">${played(2, "tn")}${played(1, "tw")}${middle}${played(3, "te")}${played(0, "ts")}</div>
      ${spot(3, "e")}
      ${bidding}
      <div class="seat s${v.turn === HUMAN ? " turn" : ""}${v.out && v.out[0] ? " out" : ""}"><div class="nm">${pfp(0)} ${myName ? `<span class="tag">${esc(myName)}</span>` : tag(0)}${dealer(0)}</div><div class="bid">${bidText(v, 0)}</div>${own(0, false)}</div>
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
      <div class="big" style="font-size:24px">${gameLabel().toUpperCase()}, ROUND ${h.no + 1}: ${h.made ? "MADE IT!" : "SET!"}</div>
      <p class="hint" style="margin:0">${tag(h.pitcher)} bid ${h.bid} in ${suitIcon(h.trump)} and ${h.made ? "made it!" : "got SET!"}</p>
      <div class="rows">
        ${row(`${ICON.high} High`, `${who(h.high.seat)} ${card(h.high.card, "mini")}`)}
        ${row(`${ICON.low} Low`, `${who(h.low.seat)} <span class="small">played</span> ${card(h.low.card, "mini")}`)}
        ${row(`${ICON.jack} Jack`, h.jack ? `${who(h.jack.seat)} ${card(h.jack.card, "mini")}` : `<span class="small">not in play</span>`)}
        ${row(`${ICON.game} Game`, h.gameWinner === null ? `<span class="small">tied: nobody</span>` : `${who(h.gameWinner)} <span class="small">${h.gameTotals[h.gameWinner]} card points</span>`)}
        ${row(`${ICON.bid} Bid`, `${who(h.pitcher)} bid ${h.bid}: ${h.made ? `<b class="up">made it</b>` : `<b class="down">set ${-h.bid}</b>`}`)}
        ${row("This round", [0, 1, 2, 3].map((s) => `${s === HUMAN && myName ? `<span class="tag">${esc(myName)}</span>` : tag(s)} ${delta(h.final[s])}`).join(" "))}
      </div>
      <button class="go" data-k="go">${last && v.over ? "See the result" : "Next round"}</button>
    </div>`;
}

// "Game #14" or "Daily game #2"
const gameLabel = () => (T.daily ? "Daily game #" : "Game #") + T.game;

function finalScreen() {
  const v = T.view, f = T.field, place = v.place;
  const winner = v.totals.indexOf(Math.max(...v.totals));
  // Two centred lines: the winner's name, big, and what happened under it. (No headline above them.)
  const winTag = winner === HUMAN ? `<span class="tag">${esc(myName || "You")}</span>` : tag(winner);
  const sub = `<span class="winname">${winTag}</span>` + (place === 1 ? `you won · first to ${v.target} in ${v.history.length} rounds` : `got there first · you placed ${ORD[place]}`);
  // Every round for every seat: a row each (the seat's emoji, total, then one bubble a round). The bubbles keep one size and the rounds scroll
  // sideways when there are more than fit; the emoji and the total stay put on the left.
  const bub = (n) => `<span class="chip ${n > 0 ? "up" : n < 0 ? "down" : ""}">${signed(n)}</span>`;
  const grid = `<div class="rwrap"><div class="rleft">
      <span class="c0 hd"></span><span class="c1 hd"></span>${[0, 1, 2, 3].map((s) => `<span class="c0 nm${s === HUMAN ? " you" : ""}" title="${esc(nameOf(s))}">${pfp(s)}</span><span class="c1 tot${s === HUMAN ? " you" : ""}${v.totals[s] === Math.max(...v.totals) ? " win" : ""}">${v.totals[s]}</span>`).join("")}
    </div><div class="rscroll"><div class="rgrid" style="--rounds:${v.history.length}">
      ${v.history.map((h) => `<span class="hd">${h.no + 1}</span>`).join("")}${[0, 1, 2, 3].map((s) => v.history.map((h) => bub(h.final[s])).join("")).join("")}
    </div></div></div>`;
  let field = "";
  if (f && f.games > 0) {
    const won = Math.round((100 * f.places[0]) / f.games);
    field = `<div class="panel">
      <div class="kv"><span>The field</span><span>${f.games} player${f.games === 1 ? "" : "s"} finished ${T.daily ? "today's Daily game" : "this game"}</span></div>
      <div class="kv"><span>Beat the table</span><span>${f.games === 1 ? "you're the first to finish it" : `${won}% of players`}</span></div>
      <div class="kv"><span>Average game</span><span>${(f.hands / f.games).toFixed(1)} rounds</span></div></div>`;
  }
  // The table's memory at work: how many of the bots' bids this game went with what the table remembered.
  const botBids = v.history.flatMap((h) => h.bids.filter((b) => b.seat !== HUMAN && !b.forced));
  const followed = [1, 2, 3].map((s) => ({ s, n: botBids.filter((b) => b.seat === s && b.crowd).length })).filter((x) => x.n);
  const memory = `<div class="panel"><div class="kv"><span>The table's memory</span><span>${botBids.filter((b) => b.crowd).length} of ${botBids.length} bot bids went with the crowd</span></div>
      ${followed.length ? `<div class="small">${followed.map((x) => `${tag(x.s)} ${x.n}`).join(" · ")}</div>` : ""}</div>`;
  const buttons = `<button class="go" data-k="play">${T.next && T.next.kind === "daily" ? "Play today's Daily game" : "Play"}</button>`;
  return header() + `
    <div class="panel"><p class="hint" style="margin:0">${sub}</p></div>
    ${scoreboard(v, true)}
    <div class="panel">${grid}</div>
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
        <div class="big" style="font-size:22px;text-align:left">${a.player ? `${esc(a.name || myName || "player " + a.id)}'s account` : "ACCOUNT"}</div>
      </div>
      ${a.player ? `<p class="small" style="margin:6px 0 0">Tap your pic for a new one.</p>` : ""}
      ${a.player ? `<div class="row" style="margin-bottom:12px"><button class="ghost" style="flex:1" data-k="name">Reroll name</button><button class="ghost" style="flex:1" data-k="out">Log out</button></div>` : ""}
      ${newCode ? `<div class="kv"><span>New save code</span><span class="code">${esc(newCode)}</span></div>
        <div class="row" style="margin-bottom:8px"><button class="ghost" style="flex:1" data-k="copy">Copy</button><button class="ghost" style="flex:1" data-k="dl">Download</button></div>
        <p class="small">Shown once. Keep it somewhere safe.</p>` : ""}
      <div class="kv"><span>Save codes</span><span>${a.codes.length}/5 <button class="link" data-k="new">new code</button></span></div>
      <div class="kv"><span>Passkeys</span><span>${a.passkeys.length} ${pkOk() ? `<button class="link" data-k="pk">add passkey</button>` : `<span class="small">this browser can't do passkeys</span>`}</span></div>
    </div>
    ${a.player ? carryPanel() : ""}
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

// The guest name the page holds: keep it (and remember it for a reload), or drop it once a save code or passkey made it theirs.
function holdName(p) {
  preview = p;
  try { if (p) localStorage.setItem("np-preview", JSON.stringify(p)); else localStorage.removeItem("np-preview"); } catch {}
}

// The player's own pic and name, when they have them. A new player has none until their first move makes them, so a move asks again.
function fetchWho() {
  api("account").then((a) => { if (a && ((a.pfp && a.pfp !== myPfp) || (a.name && a.name !== myName))) { if (a.pfp) myPfp = a.pfp; if (a.name) myName = a.name; if (mode === "game") draw(); } });
}

async function load() {
  fetchWho();
  const r = await api("game");
  if (r.error) { msg = r.error; mode = "loading"; return draw(); }
  T = r;
  if (r.you) {   // a guest (no name on the server): keep the name they were first shown (so a reload doesn't change it), and show it as theirs
    try { const kept = JSON.parse(localStorage.getItem("np-preview")); if (kept && kept.name && kept.sig) preview = kept; } catch {}
    if (!preview) holdName(r.you);
    if (!myName) myName = preview.name;
  }
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
  T = r; seen = T.view.history.length; playFromStart();
}

async function send(action) {
  if (busy || !T) return;
  hotBid = 0; hotCard = "";
  busy = true; msg = ""; draw();
  const r = await api("act", { game: T.game, daily: !!T.daily, n: T.n, action });
  busy = false;
  const old = T.view;
  if (r.view) T = r;   // a refused move still brings the game as it is
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
async function openAccount(m = "") { acctMsg = m; acct = await api("account"); if (acct.pfp) myPfp = acct.pfp; if (acct.name) myName = acct.name; copies = acct.player ? (await api("copies")).copies || [] : []; mode = "account"; draw(); }

// (v0.13) CARRY: the copy you carry (your account's pinned copy from any 88x31 game, /api/game carry), gold if the Moon blessed
// it, and every copy your account holds, newest first, each with a pin button. Winning the Daily marks the one you carry.
let copies = [];
function carryPanel() {
  const c = T && T.carry;
  const rows = copies.slice(0, 12).map((x, i) => `<div class="kv"><span>${esc(x.name)} #${x.copy} <span class="small">${esc(x.game)}</span></span><span>${x.pinned ? `<span class="small">pinned</span>` : `<button class="link" data-k="pin${i}">pin</button>`}</span></div>`).join("");
  return `<div class="panel">
      <div class="kv"><span>Carrying</span><span${c && c.blessed ? ' style="color:#e3b341"' : ""}>${c ? `${esc(c.name)} #${c.copy}` : "nothing yet"}</span></div>
      <p class="small">Win the Daily and it gets a mark. Pin another below.</p>${rows}</div>`;
}
async function pinCarry(i) {
  const x = copies[i]; if (!x) return;
  const r = await api("pin", { itemId: x.itemId, copy: x.copy });
  if (r.error) return openAccount(r.error);
  await load(); await openAccount("Pinned. Every game carries it now.");
}
async function changed(m) { newCode = null; holdName(null); await load(); await openAccount(m); }

const ACCOUNT_KEYS = {
  async new() { const r = await api("codes", { action: "new", ...(preview ? { preview } : {}) }); if (r.error) return openAccount(r.error); newCode = r.code; holdName(null); await load(); await openAccount(); },
  async copy() { try { await navigator.clipboard.writeText(newCode); acctMsg = "Copied. Keep it somewhere safe."; } catch { acctMsg = "Couldn't copy. Write it down instead."; } draw(); },
  async dl() {
    const text = `Daily Pitch save code\r\n\r\n  ${newCode}\r\n\r\nOn any browser: open ${location.origin}, open Account, and use this code under "Log in on this device".\r\nIt works in the other 88x31 games too. Keep it private: anyone with it can log in as you.\r\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = "daily-pitch-save-code.txt";
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  async use() { const code = (document.getElementById("codein")?.value || "").trim(); const r = await api("load", { code }); if (r.error) return openAccount(r.error); await changed("Logged in."); },
  async pfp() { const others = PFP_POOL.filter((e) => e !== myPfp); await pickPfp(others[Math.floor(Math.random() * others.length)]); },   // a random new pic each tap
  async name() {
    const r = await api("name", {}); if (r.error) return openAccount(r.error);
    if (r.sig) { holdName({ name: r.name, sig: r.sig }); myName = r.name; }   // a guest: the new name stays in this browser
    await openAccount(`You're ${r.name} now.`);
  },
  async out() { const r = await api("logout", {}); if (r.error) return openAccount(r.error); await changed("Logged out."); },
  async pk() {
    acctMsg = "Waiting for your fingerprint, face or PIN…"; draw();
    try {
      const o = await api("passkey", { action: "register_options", ...(preview ? { preview } : {}) }); if (o.error) return openAccount(o.error);
      const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64(o.challenge), user: { ...o.user, id: unb64(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: unb64(c.id) })) } });
      const r = await api("passkey", { action: "register", ...(preview ? { preview } : {}), label: device(), credential: { id: cred.id, response: { clientDataJSON: b64(cred.response.clientDataJSON), attestationObject: b64(cred.response.attestationObject) } } });
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

// You can act once your turn is on and every move before it has been shown: the table may still be holding its last pause (a card
// or a finished trick to look at), but that is no reason to make you wait.
const canAct = () => !rp || (rp.k >= rp.evs.length && T.view.turn === HUMAN && !pending());

function press(k) {
  if (mode === "account" && /^pin\d+$/.test(k)) return pinCarry(Number(k.slice(3)));
  if (mode === "account") { const f = ACCOUNT_KEYS[k]; if (f) f(); return; }
  if (mode !== "game" || !T) return;
  if (k === "a") return openAccount();
  if (!canAct()) return;   // moves are playing out
  const v = T.view;
  if (k === "go") { if (pending()) { seen = v.history.length; msg = ""; playFromStart(); } return; }
  if (k === "play" && v.over) return play();
  if (pending()) return;   // the result of a hand is on screen: moves wait until it's dismissed
  if (k[0] === "b" && v.phase === "bid") return send({ type: "bid", bid: Number(k.slice(1)) });
  if (k[0] === "c" && v.phase === "play") return send({ type: "play", card: Number(k.slice(1)) });
}

// The lit bid follows the mouse and stays where it left (a redraw keeps it too, through hotBid).
$app.addEventListener("mouseover", (e) => {
  const c = e.target.closest(".hand .pc.ok");
  hotCard = c ? c.dataset.k : "";   // the redraws while the table plays (and the chat) rebuild your cards; this keeps the one under the mouse lifted
  for (const x of document.querySelectorAll(".hand .pc.hot")) if (x !== c) x.classList.remove("hot");   // the card the mouse left drops now, not at the next redraw
  if (c) c.classList.add("hot");
  const b = e.target.closest(".bids button:not(:disabled)");
  if (!b) return;
  hotBid = Number(b.dataset.k.slice(1));
  for (const x of b.parentElement.children) x.classList.toggle("hot", x === b);
});

$app.addEventListener("mouseleave", () => { hotCard = ""; for (const x of document.querySelectorAll(".hand .pc.hot")) x.classList.remove("hot"); });

// A card or a bid plays when the button goes down, not when it comes back up: a redraw between the two (the chat and the replay
// rebuild every card) would throw the click away. The click that follows is ignored so it can't play twice.
let downAt = 0;
$app.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest(".hand .pc.ok, .bids button:not(:disabled)");
  if (!el || !el.dataset.k) return;
  downAt = Date.now();
  press(el.dataset.k);
});

$app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-k]");
  if (el && !el.disabled && !(Date.now() - downAt < 700 && /^[bc]\d/.test(el.dataset.k))) press(el.dataset.k);
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
