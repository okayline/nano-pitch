// Daily Pitch screen (a day is one game to 11 points, several hands): an 80-column text screen in the scoundrel.exe / Daily Digital Demon Dungeon style.
// Everything is drawn as lines of text in one <pre>. A line is a list of segments: plain strings, or
// { t, c (css class), k (a key: clicking it is the same as pressing it) }, or { card, c, k } for a card,
// or { input, w } for the save code box. Every character is one column; suit symbols sit in a 1-column box.
import { VERSION } from "./version.js";
import { suitOf, rankOf, HUMAN } from "./engine/pitch.js";

const W = 80, IN = W - 4, H = 25;
const NAMES = ["YOU", "WEST", "NORTH", "EAST"];   // seats in play order: you, then the bot on your left, across, right
const SUIT = ["♣", "♦", "♥", "♠"];
const RED = [false, true, true, false];
const RANK = { 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };

const $screen = document.getElementById("screen");
document.getElementById("ver").textContent = VERSION;

let T = null;          // the last answer from /api/today or /api/act: { day, n, view, field }
let mode = "loading";  // loading | game | account
let busy = false;
let seen = 0;          // how many finished hands the player has been shown the result of
let msg = "";
let acct = null, newCode = null, acctMsg = "";

// ---------- small helpers ----------

const S = (t, c, k) => ({ t, c, k });
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rk = (c) => RANK[rankOf(c)] || String(rankOf(c));
const segLen = (s) => (typeof s === "string" ? s.length : s.input ? s.w : s.card !== undefined ? rk(s.card).length + 1 : s.t.length);
const len = (segs) => segs.reduce((n, s) => n + segLen(s), 0);
const padTo = (segs, w) => { const n = len(segs); return n < w ? [...segs, " ".repeat(w - n)] : segs; };
const spread = (a, b, w = IN) => { const A = [].concat(a), B = [].concat(b); return [...A, " ".repeat(Math.max(1, w - len(A) - len(B))), ...B]; };
const center = (segs, w = IN) => { segs = [].concat(segs); return [" ".repeat(Math.max(0, Math.floor((w - len(segs)) / 2))), ...segs]; };
const right = (segs, w) => { segs = [].concat(segs); return [" ".repeat(Math.max(0, w - len(segs))), ...segs]; };
const cols3 = (a, b, c) => [...padTo([].concat(a), 26), ...padTo(center(b, 24), 24), ...right(c, 26)];
const dots = (label, w = 12) => label + " " + ".".repeat(Math.max(2, w - label.length)) + " ";
const C = (card, c, k) => ({ card, c, k });
const pad2 = (n) => String(n).padStart(2, "0");
const signed = (n) => (n > 0 ? "+" + n : String(n));

function untilMidnight() {
  const now = new Date(), next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}
function stamp(day) {
  const d = new Date(day + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).toUpperCase().replace(/,/g, "");
}

// ---------- drawing ----------

// "=" and "-" are rules, "~" is stretchy blank space (so every screen is H rows tall), anything else is a line in the frame.
function frame(rows) {
  const spacers = rows.filter((r) => r === "~").length;
  let extra = Math.max(0, H - (rows.length - spacers));
  rows = rows.flatMap((r, i) => {
    if (r !== "~") return [r];
    const n = Math.ceil(extra / rows.slice(i).filter((x) => x === "~").length);
    extra -= n;
    return Array(n).fill("");
  });
  return rows.map((r) => {
    if (r === "=") return [S("+" + "=".repeat(W - 2) + "+", "fr")];
    if (r === "-") return [S("+" + "-".repeat(W - 2) + "+", "fr")];
    return [S("| ", "fr"), ...padTo([].concat(r), IN), S(" |", "fr")];
  });
}

function html(lines) {
  return lines.map((segs) => segs.map((s) => {
    if (typeof s === "string") return esc(s);
    if (s.input) return `<input id="codein" class="codein" maxlength="40" spellcheck="false" autocomplete="off" style="width:${s.w}ch" aria-label="Save code">`;
    const inner = s.card !== undefined
      ? `${esc(rk(s.card))}<span class="g">${SUIT[suitOf(s.card)]}</span>`
      : esc(s.t);
    const cls = [s.card !== undefined && RED[suitOf(s.card)] ? "red" : "", s.c, s.k ? "btn" : ""].filter(Boolean).join(" ");
    return cls || s.k ? `<span${cls ? ` class="${cls}"` : ""}${s.k ? ` data-k="${esc(s.k)}"` : ""}>${inner}</span>` : inner;
  }).join(""));
}

let shown = [], drawnMode = null;
function draw() {
  const same = drawnMode === mode;
  const typed = same ? document.getElementById("codein")?.value : null;   // typing survives redraws of the same screen
  drawnMode = mode;
  const rows = html(frame({ loading: loadingScreen, game: gameScreen, account: accountScreen }[mode]()));
  const spans = $screen.children;
  if (same && spans.length === rows.length) rows.forEach((r, i) => { if (r !== shown[i]) spans[i].innerHTML = r; });
  else $screen.innerHTML = rows.map((r) => `<span class="ln">${r}</span>`).join("\n");
  shown = rows;
  const box = document.getElementById("codein");
  if (box && typed != null) box.value = typed;
}

const header = () => [spread([S("DAILY PITCH", "you"), ...(T && T.practice ? [S("  PRACTICE", "dim")] : [])], T ? stamp(T.day) + " // " + VERSION : VERSION), "="];

function loadingScreen() { return [...header(), "~", center(msg || "DEALING..."), "~", "="]; }

// ---------- the table ----------

function bidText(v, seat) {
  const b = v.bids.find((x) => x.seat === seat);
  if (!b) return v.phase === "bid" && v.turn === seat ? S("...", "dim") : "";
  if (b.forced) return S("STUCK 2", "dim");
  return b.bid ? S("BID " + b.bid, seat === v.pitcher ? "you" : "") : S("PASS", "dim");
}
const dealerMark = (v, seat) => (v.dealer === seat ? S(" (D)", "dim") : "");
const backs = (n) => S("#".repeat(n), "faint");
const tricksWon = (v, seat) => v.tricks.filter((t) => t.winner === seat).length;

// The trick on the table: the current one, or the last finished one (dimmed) between tricks.
function tableTrick(v) {
  if (v.trick.length) return { plays: v.trick, done: false };
  if (v.tricks.length) return { plays: v.tricks[v.tricks.length - 1].plays, done: true, winner: v.tricks[v.tricks.length - 1].winner };
  return { plays: [], done: false };
}
function playedBy(tt, seat) {
  const p = tt.plays.find((x) => x.seat === seat);
  if (!p) return "  ";
  return C(p.card, tt.done && tt.winner !== seat ? "dim" : "");
}

function handRow(v) {
  const legal = new Set(v.legal || []), canPlay = v.phase === "play" && v.turn === HUMAN && !busy;
  const segs = [];
  v.hand.forEach((c, i) => {
    if (i) segs.push("  ");
    const ok = canPlay && legal.has(c);
    segs.push(S(`[${i + 1}]`, ok ? "" : "faint", ok ? "c" + c : null), C(c, ok ? "" : "faint", ok ? "c" + c : null));
  });
  return center(segs);
}

function controls(v) {
  if (busy) return [S("...", "dim")];
  if (v.phase === "bid" && v.turn === HUMAN) {
    const segs = [S("YOUR BID: ", "dim")];
    for (const b of [0, 2, 3, 4]) {
      const ok = v.bidOptions.includes(b), label = b ? `[${b}]` : "[P]ASS";
      segs.push(S(label, ok ? "" : "off", ok ? "b" + b : null), " ");
    }
    return segs;
  }
  if (v.phase === "play" && v.turn === HUMAN) return [S(v.trick.length || v.trump !== null ? "YOUR CARD: 1-6" : "YOUR LEAD NAMES TRUMP: 1-6", "dim")];
  return [S("WAITING", "dim")];
}

function trickLine(v) {
  const done = v.tricks.length ? v.tricks[v.tricks.length - 1] : null;
  if (!done) return "";
  const segs = [S("LAST TRICK ", "dim")];
  for (const p of done.plays) segs.push(S(NAMES[p.seat][0] + " ", "dim"), C(p.card), "  ");
  segs.push(S("-> " + NAMES[done.winner], "you"));
  return segs;
}

const ORD = ["", "1ST", "2ND", "3RD", "4TH"];
const pending = () => T.view.history.length > seen;   // a finished hand whose result hasn't been shown yet
const totalsLine = (v) => [0, 1, 2, 3].map((s) => [S(NAMES[s] + " ", s === HUMAN ? "you" : "dim"), String(v.totals[s]), s < 3 ? "   " : ""]).flat();

function gameScreen() {
  const v = T.view;
  if (pending()) return handScreen(v.history[seen]);
  if (v.over) return finalScreen();
  const tt = tableTrick(v);
  const trumpSeg = v.trump === null ? [S("TRUMP ", "dim"), S("--", "dim")] : [S("TRUMP ", "dim"), { t: SUIT[v.trump], c: RED[v.trump] ? "red g" : "g" }];
  const pitch = v.pitcher === null ? [] : [S("   BIDDER ", "dim"), NAMES[v.pitcher] + " " + v.bid];
  const won = [S("TRICKS ", "dim"), [0, 1, 2, 3].map((s) => NAMES[s][0] + " " + tricksWon(v, s)).join("  ")];
  const middle = v.phase === "bid" ? S("BIDDING", "dim") : [playedBy(tt, 1), "            ", playedBy(tt, 3)];
  return [
    ...header(),
    spread([S("HAND " + (v.no + 1), "dim"), "   ", ...totalsLine(v)], S("FIRST TO " + v.target, "dim")),
    center([S("NORTH", ""), dealerMark(v, 2), "  ", backs(v.counts[2]), "  ", bidText(v, 2)]),
    "",
    cols3("", v.phase === "bid" ? "" : playedBy(tt, 2), ""),
    cols3([S("WEST", ""), dealerMark(v, 1), "  ", backs(v.counts[1])], middle, [backs(v.counts[3]), "  ", S("EAST", ""), dealerMark(v, 3)]),
    cols3(["      ", bidText(v, 1)], v.phase === "bid" ? "" : playedBy(tt, 0), [bidText(v, 3), "      "]),
    "",
    center([S("YOU", "you"), dealerMark(v, 0), "  ", bidText(v, 0)]),
    handRow(v),
    "~",
    "-",
    spread([...trumpSeg, ...pitch], won),
    trickLine(v),
    msg ? S(msg, "you") : "",
    "-",
    spread(controls(v), S("[A]CCOUNT", "", "a")),
    "=",
  ];
}

// ---------- the result and the field ----------

const who = (seat) => S(NAMES[seat], seat === HUMAN ? "you" : "");

// The result of one finished hand (h is the hand's summary from the server).
function handScreen(h) {
  const v = T.view, last = h.no === v.history.length - 1;
  return [
    ...header(),
    spread(S(`HAND ${h.no + 1} OVER`, "you"), [S("TRUMP ", "dim"), { t: SUIT[h.trump], c: RED[h.trump] ? "red g" : "g" }]),
    "",
    [dots("HIGH"), who(h.high.seat), "  ", C(h.high.card, "dim")],
    [dots("LOW"), who(h.low.seat), S("  won the trick with ", "dim"), C(h.low.card, "dim")],
    [dots("JACK"), ...(h.jack === null ? [S("not in play", "dim")] : [who(h.jack.seat), "  ", C(h.jack.card, "dim")])],
    [dots("GAME"), ...(h.gameWinner === null ? [S("tied: nobody", "dim")] : [who(h.gameWinner), S(`  ${h.gameTotals[h.gameWinner]} card points`, "dim")])],
    [dots("PITCH"), who(h.pitcher), ` bid ${h.bid}: `, h.made ? S("MADE IT", "you") : S(`SET (${-h.bid})`, "")],
    "",
    [dots("THIS HAND"), [0, 1, 2, 3].map((x) => NAMES[x] + " " + signed(h.final[x])).join("   ")],
    [dots("TOTALS"), ...totalsLine(v)],
    "~",
    "-",
    spread(S(last && v.over ? "[ENTER] SEE THE RESULT" : "[ENTER] NEXT HAND", "", "go"), S("[A]CCOUNT", "", "a")),
    "=",
  ];
}

// The finished game, and the field: how everyone placed on the same deals.
function finalScreen() {
  const v = T.view, f = T.field, place = v.place;
  const rows = [
    ...header(),
    spread(S("GAME OVER", "you"), S(place === 1 ? "YOU WON" : `YOU PLACED ${ORD[place]}`, "you")),
    "",
    [dots("FINAL", 12), ...totalsLine(v)],
    [dots("HANDS", 12), String(v.history.length)],
    "",
  ];
  const finals = v.history.map((h) => signed(h.final[HUMAN]));
  for (let i = 0; i < finals.length; i += 20) rows.push([S(i ? "" : "YOUR HANDS ", "dim"), i ? " ".repeat(11) : "", finals.slice(i, i + 20).join(" ")]);
  rows.push("");
  if (!T.practice && f && f.games > 0) {
    const won = Math.round((100 * f.places[0]) / f.games);
    rows.push(
      [dots("THE FIELD"), `${f.games} player${f.games === 1 ? "" : "s"} finished on these deals`],
      f.games === 1 ? S("  you're the first to finish today", "dim") : `  you placed ${ORD[place]}; ${won}% of players won their game`,
      `  an average game took ${(f.hands / f.games).toFixed(1)} hands`,
    );
  }
  const left = T.practice ? [S("[P] ANOTHER PRACTICE GAME", "", "practice"), "  ", S("[T]ODAY", "", "daily")]
    : [S("[P]RACTICE GAME", "", "practice"), S("   NEXT DEAL IN ", "dim"), untilMidnight()];
  rows.push("~", msg ? S(msg, "you") : "", "-", spread(left, S("[A]CCOUNT", "", "a")), "=");
  return rows;
}

// ---------- the account (save codes and passkeys, from the shared 88x31 accounts) ----------

function accountScreen() {
  const a = acct || { player: false, codes: [], passkeys: [], devices: 0 };
  const rows = [...header(), S("ACCOUNT", "you"), ""];
  rows.push(a.player ? `You're player ${a.id}, on ${a.devices} device${a.devices === 1 ? "" : "s"}.` : S("No player here yet: play a card, or log in below.", "dim"));
  rows.push(S("A save code or passkey brings your hand to another device.", "dim"), "");
  if (newCode) rows.push([S("NEW SAVE CODE (shown once): ", "dim"), S(newCode, "you")], [S("[C]OPY", "", "copy"), "  ", S("[D]OWNLOAD", "", "dl")], "");
  rows.push([`SAVE CODES ${a.codes.length}/5   `, S("[N]EW CODE", "", "new")]);
  rows.push([`PASSKEYS ${a.passkeys.length}     `, pkOk() ? S("[K] ADD PASSKEY", "", "pk") : S("this browser can't do passkeys", "dim")]);
  rows.push("", [S("LOG IN: ", "dim"), { input: true, w: 30 }, " ", S("[U]SE CODE", "", "use"), ...(pkOk() ? ["  ", S("[G] PASSKEY", "", "pkin")] : [])]);
  if (a.codes.length || a.passkeys.length) rows.push("", S("[O] LOG OUT OF THIS BROWSER", "", "out"));
  rows.push("~", acctMsg ? S(acctMsg, "you") : "", "-", spread(S("[ESC] BACK", "", "esc"), ""), "=");
  return rows;
}

// ---------- talking to the server ----------

async function api(path, data) {
  const r = await fetch("/api/" + path, data ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) } : {});
  return r.json().catch(() => ({ error: "That didn't work. Try again." }));
}

async function practice() {
  if (busy) return;
  busy = true; msg = ""; draw();
  const r = await api("practice/new", {});
  busy = false;
  if (r.error) { msg = r.error; return draw(); }
  T = { day: T.day, n: r.n, view: r.view, field: null, practice: r.practice }; seen = T.view.history.length; draw();
}

async function load() {
  const r = await api("today");
  if (r.error) { msg = r.error; mode = "loading"; return draw(); }
  T = { ...r, practice: null }; msg = r.reset ? "The bots changed since your last move, so today's game started over." : ""; mode = "game"; seen = T.view.history.length; draw();   // a game reloaded in progress doesn't replay old results
}

async function send(action) {
  if (busy || !T) return;
  busy = true; msg = ""; draw();
  const r = T.practice ? await api("practice/act", { id: T.practice, n: T.n, action }) : await api("act", { day: T.day, n: T.n, action });
  busy = false;
  if (r.view) T = { day: T.day, n: r.n, view: r.view, field: r.field, practice: T.practice };   // a refused move still brings the hand as it is
  if (r.error) msg = r.error;
  else if (r.view.over) msg = "Sealed on the ledger.";
  draw();
}

// ---------- passkeys (WebAuthn in the browser, copied from moba-beat public/account.js) ----------

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (t) => { t = t.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0)); };
const pkOk = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
const device = () => { const u = navigator.userAgent; return /Android/.test(u) ? "Android" : /iPhone|iPad/.test(u) ? "iPhone" : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows PC" : "This device"; };
const pkOops = (e) => (e && e.name === "NotAllowedError" ? "Passkey cancelled (or it timed out)." : (e && e.message) || "The passkey didn't work.");

async function openAccount(m = "") { acctMsg = m; acct = await api("account"); mode = "account"; draw(); }
async function changed(m) { newCode = null; await load(); await openAccount(m); }

const ACCOUNT_KEYS = {
  async new() { const r = await api("codes", { action: "new" }); if (r.error) return openAccount(r.error); newCode = r.code; await load(); await openAccount(); },
  async copy() { try { await navigator.clipboard.writeText(newCode); acctMsg = "Copied. Keep it somewhere safe."; } catch { acctMsg = "Couldn't copy. Write it down instead."; } draw(); },
  async dl() {
    const text = `Daily Pitch save code\r\n\r\n  ${newCode}\r\n\r\nOn any browser: open ${location.origin}, open ACCOUNT, and use this code under LOG IN.\r\nIt works in the other 88x31 games too. Keep it private: anyone with it can log in as you.\r\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = "daily-pitch-save-code.txt";
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  async use() { const code = (document.getElementById("codein")?.value || "").trim(); const r = await api("load", { code }); if (r.error) return openAccount(r.error); await changed("Logged in."); },
  async out() { const r = await api("logout", {}); if (r.error) return openAccount(r.error); await changed("Logged out."); },
  async pk() {
    acctMsg = "Waiting for your fingerprint, face or PIN..."; draw();
    try {
      const o = await api("passkey", { action: "register_options" }); if (o.error) return openAccount(o.error);
      const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64(o.challenge), user: { ...o.user, id: unb64(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: unb64(c.id) })) } });
      const r = await api("passkey", { action: "register", label: device(), credential: { id: cred.id, response: { clientDataJSON: b64(cred.response.clientDataJSON), attestationObject: b64(cred.response.attestationObject) } } });
      if (r.error) return openAccount(r.error);
      await changed("Passkey added.");
    } catch (e) { acctMsg = pkOops(e); draw(); }
  },
  async pkin() {
    acctMsg = "Waiting for your passkey..."; draw();
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

// ---------- input ----------

function press(k) {
  if (mode === "account") { const f = ACCOUNT_KEYS[k]; if (f) f(); return; }
  if (mode !== "game" || !T) return;
  if (k === "a") return openAccount();
  const v = T.view;
  if (k === "go") { if (pending()) { seen = v.history.length; msg = ""; draw(); } return; }
  if (k === "practice" && v.over) return practice();
  if (k === "daily" && T.practice) return load();
  if (pending()) return;   // the result of a hand is on screen: moves wait until it's dismissed
  if (k[0] === "b" && v.phase === "bid") return send({ type: "bid", bid: Number(k.slice(1)) });
  if (k[0] === "c" && v.phase === "play") return send({ type: "play", card: Number(k.slice(1)) });
}

$screen.addEventListener("click", (e) => {
  const el = e.target.closest("[data-k]");
  if (el && !el.classList.contains("off")) press(el.dataset.k);
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
  if (pending()) { if (key === "enter" || key === " ") { e.preventDefault(); press("go"); } return; }
  if (v.over) { if (key === "p") press("practice"); else if (key === "t") press("daily"); return; }
  if (v.phase === "bid" && v.turn === HUMAN) {
    const bid = key === "p" || key === "0" ? 0 : ["2", "3", "4"].includes(key) ? Number(key) : null;
    if (bid !== null && v.bidOptions.includes(bid)) send({ type: "bid", bid });
    return;
  }
  if (v.phase === "play" && v.turn === HUMAN && /^[1-6]$/.test(key)) {
    const card = v.hand[Number(key) - 1];
    if (card !== undefined && (v.legal || []).includes(card)) send({ type: "play", card });
  }
});

setInterval(() => { if (mode === "game" && T && T.view.over && !pending()) draw(); }, 1000);   // the countdown
load();
