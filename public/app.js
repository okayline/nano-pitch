// Daily Pitch page: you against the table. The table is one robot that plays the other three hands, called lagspike (left),
// mogger99 (top) and tiltproof (right), gamer tags from TILT.EXE; a day is one game to 11 points over as many hands as it takes. The look follows aura-farm:
// dark, purple glow, rounded panels. Everything is drawn into #app from the last answer of /api/today, /api/act or
// /api/practice*.
import { VERSION } from "./version.js";
import { suitOf, rankOf, HUMAN } from "./engine/pitch.js";

const SPOT = ["You", "lagspike", "mogger99", "tiltproof"];   // seats in play order: you, then the table's hands clockwise (TILT.EXE gamer tags)
const SUIT = ["♣", "♦", "♥", "♠"];
const RED = [false, true, true, false];
const RANK = { 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };
const ORD = ["", "1st", "2nd", "3rd", "4th"];
const PFP = ["😎", "🐌", "🗿", "🧊"];                  // profile pics: you, then lagspike (lag), mogger99 (the stare), tiltproof (ice cold)
const ICON = { table: "🤖", high: "👑", low: "🪶", jack: "🃏", game: "🎯", bid: "🔥" };

const $app = document.getElementById("app");

let T = null;          // the last answer: { day, n, view, field, practice }
let mode = "loading";  // loading | game | account
let busy = false;
let seen = 0;          // how many finished hands the player has been shown the result of
let msg = "";
let acct = null, newCode = null, acctMsg = "";

// ---------- small helpers ----------

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rk = (c) => RANK[rankOf(c)] || String(rankOf(c));
const signed = (n) => (n > 0 ? "+" + n : String(n));
const pad2 = (n) => String(n).padStart(2, "0");
const tag = (seat) => (seat === HUMAN ? `<b>You</b>` : `<span class="tag s${seat}">${SPOT[seat]}</span>`);   // a hand's name, in its colour
const who = (seat) => `${PFP[seat]} ${tag(seat)}`;
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

// ---------- drawing ----------

function draw() {
  const typed = document.getElementById("codein")?.value;   // typing survives a redraw
  $app.classList.toggle("busy", busy);
  $app.innerHTML = { loading: loadingScreen, game: gameScreen, account: accountScreen }[mode]() + `<div class="ver">${esc(VERSION)}</div>`;
  const box = document.getElementById("codein");
  if (box && typed != null) box.value = typed;
}

function header() {
  const sub = T ? `${stamp(T.day)} · ${T.practice ? "practice game" : "first to " + T.view.target}` : "one game a day";
  const right = mode === "account" ? `<button class="link" data-k="esc">Back</button>` : `<button class="link" data-k="a">Account</button>`;
  return `<header><div class="title">DAILY PITCH<small>${esc(sub)}</small></div>${right}</header>`;
}

function loadingScreen() { return header() + `<div class="panel"><p class="hint">${esc(msg || "Dealing…")}</p></div>`; }

// You and the table's three hands, with the running totals and how close the leader is to 11.
function scoreboard(v) {
  const top = Math.max(...v.totals);
  const cell = (seat) => `<div class="score${seat === HUMAN ? " you" : ""}${v.totals[seat] === top && top > 0 ? " lead" : ""}">
      <div class="em">${PFP[seat]}</div><div class="nm">${tag(seat)}</div><div class="pt">${v.totals[seat]}</div></div>`;
  const pct = Math.max(0, Math.min(100, (100 * top) / v.target));
  return `<div class="panel"><div class="between small"><span>Hand ${v.no + 1}</span><span>first to ${v.target}</span></div>
    <div class="scores" style="margin-top:8px">${[0, 1, 2, 3].map(cell).join("")}</div><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
}

// ---------- the table ----------

const pending = () => T.view.history.length > seen;   // a finished hand whose result hasn't been shown yet

function bidText(v, seat) {
  const b = v.bids.find((x) => x.seat === seat);
  if (!b) return v.phase === "bid" && v.turn === seat ? `<span class="small">${seat === HUMAN ? "your bid" : "thinking…"}</span>` : "";
  if (b.forced) return `<span class="chip">stuck 2</span>`;
  return b.bid ? `<span class="chip${seat === v.pitcher ? " hot" : ""}">${ICON.bid} bid ${b.bid}</span>` : `<span class="small">pass</span>`;
}

// The trick on the table: the current one, or the last finished one (with its winner lit) between tricks.
function tableTrick(v) {
  if (v.trick.length) return { plays: v.trick, done: false };
  const last = v.tricks[v.tricks.length - 1];
  return last ? { plays: last.plays, done: true, winner: last.winner } : { plays: [], done: false };
}

function gameScreen() {
  const v = T.view;
  if (pending()) return handScreen(v.history[seen]);
  if (v.over) return finalScreen();
  const tt = tableTrick(v);
  const played = (seat, cls) => {
    const p = tt.plays.find((x) => x.seat === seat);
    return p ? `<div class="${cls}">${card(p.card, tt.done ? (tt.winner === seat ? "win" : "dim") : "")}</div>` : "";
  };
  const dealer = (seat) => (v.dealer === seat ? '<span class="d">D</span>' : "");
  const spot = (seat, cls) => `<div class="seat ${cls}${v.turn === seat ? " turn" : ""}">
      <div class="nm">${PFP[seat]} ${tag(seat)}${dealer(seat)}</div>${backs(v.counts[seat])}<div class="bid">${bidText(v, seat)}</div></div>`;
  const middle = v.phase === "bid" ? `<div class="mid"><span class="bot">${ICON.table}</span><br>bidding</div>` : (tt.plays.length ? "" : `<div class="mid"><span class="bot">${ICON.table}</span></div>`);

  const legal = new Set(v.legal || []), canPlay = v.phase === "play" && v.turn === HUMAN;
  const hand = v.hand.map((c) => (canPlay && legal.has(c) ? card(c, "ok", "c" + c) : card(c, canPlay ? "no" : ""))).join("");

  let controls = "";
  if (v.phase === "bid" && v.turn === HUMAN) {
    controls = `<div class="bids">${[0, 2, 3, 4].map((b) => `<button data-k="b${b}" ${v.bidOptions.includes(b) ? "" : "disabled"} class="${b === 4 ? "hot" : ""}">${b ? b : "Pass"}</button>`).join("")}</div>`;
  } else if (canPlay) {
    controls = `<p class="hint">${v.trick.length || v.trump !== null ? "Play a card" : "Your lead names trump"}</p>`;
  }

  const short = (s) => (s === HUMAN ? "<b>You</b>" : `<span class="tag s${s}">${SPOT[s][0]}</span>`);   // the names are long: initials here
  const tricks = [0, 1, 2, 3].map((s) => `${short(s)} ${v.tricks.filter((t) => t.winner === s).length}`).join(" ");
  const chips = `<div class="row">${v.trump === null ? `<span class="chip">Trump —</span>` : suitChip(v.trump)}
      ${v.pitcher === null ? "" : `<span class="chip">Bidder ${tag(v.pitcher)} ${v.bid}</span>`}
      <span class="chip">Tricks ${tricks}</span></div>`;

  return header() + scoreboard(v) + `
    <div class="panel table">
      ${spot(2, "n")}${spot(1, "w")}
      <div class="center">${played(2, "tn")}${played(1, "tw")}${middle}${played(3, "te")}${played(0, "ts")}</div>
      ${spot(3, "e")}
      <div class="seat s${v.turn === HUMAN ? " turn" : ""}"><div class="nm">${PFP[0]} ${tag(0)}${dealer(0)}</div><div class="bid">${bidText(v, 0)}</div></div>
    </div>
    ${chips}
    <div class="hand">${hand}</div>
    ${controls}
    <p class="msg">${esc(msg)}</p>`;
}

// ---------- the result of a hand, and of the game ----------

function handScreen(h) {
  const v = T.view, last = h.no === v.history.length - 1;
  const row = (label, value) => `<div class="kv"><span>${label}</span><span>${value}</span></div>`;
  const delta = (n) => `<span class="${n > 0 ? "up" : n < 0 ? "down" : "small"}">${signed(n)}</span>`;
  return header() + `
    <div class="panel">
      <div class="between"><div class="big" style="font-size:24px">HAND ${h.no + 1} OVER</div>${suitChip(h.trump)}</div>
      <div style="margin-top:10px">
        ${row(`${ICON.high} High`, `${who(h.high.seat)} ${card(h.high.card, "mini")}`)}
        ${row(`${ICON.low} Low`, `${who(h.low.seat)} <span class="small">won the trick with</span> ${card(h.low.card, "mini")}`)}
        ${row(`${ICON.jack} Jack`, h.jack ? `${who(h.jack.seat)} ${card(h.jack.card, "mini")}` : `<span class="small">not in play</span>`)}
        ${row(`${ICON.game} Game`, h.gameWinner === null ? `<span class="small">tied: nobody</span>` : `${who(h.gameWinner)} <span class="small">${h.gameTotals[h.gameWinner]} card points</span>`)}
        ${row(`${ICON.bid} Bid`, `${who(h.pitcher)} bid ${h.bid}: ${h.made ? `<b class="up">made it</b>` : `<b class="down">set ${-h.bid}</b>`}`)}
        ${row("This hand", [0, 1, 2, 3].map((s) => `${tag(s)} ${delta(h.final[s])}`).join(" "))}
      </div>
    </div>
    ${scoreboard(v)}
    <button class="go" data-k="go">${last && v.over ? "See the result" : "Next hand"}</button>`;
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
  const buttons = T.practice
    ? `<button class="go" data-k="practice">Another practice game</button><button class="ghost" data-k="daily">Back to today</button>`
    : `<button class="go" data-k="practice">Practice game</button><p class="hint">Next deal in <span data-clock>${untilMidnight()}</span></p>`;
  return header() + `
    <div class="panel"><div class="big">${headline}</div><p class="hint" style="margin:6px 0 0">${sub}</p></div>
    ${scoreboard(v)}
    <div class="panel"><div class="small" style="margin-bottom:8px">Your score each hand</div><div class="hands">${finals}</div></div>
    ${field}
    <p class="msg">${esc(msg)}</p>
    ${buttons}`;
}

// ---------- the account (save codes and passkeys, from the shared 88x31 accounts) ----------

function accountScreen() {
  const a = acct || { player: false, codes: [], passkeys: [], devices: 0 };
  return header() + `
    <div class="panel">
      <div class="big" style="font-size:22px;text-align:left">ACCOUNT</div>
      <p class="small">${a.player ? `You're player ${a.id}, on ${a.devices} device${a.devices === 1 ? "" : "s"}.` : "No player here yet: play a card, or log in below."}
        A save code or passkey brings your game to another device.</p>
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
      ${a.codes.length || a.passkeys.length ? `<p style="text-align:center;margin:12px 0 0"><button class="link" data-k="out">Log out of this browser</button></p>` : ""}
    </div>
    <p class="msg">${esc(acctMsg)}</p>`;
}

// ---------- talking to the server ----------

async function api(path, data) {
  const r = await fetch("/api/" + path, data ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) } : {});
  return r.json().catch(() => ({ error: "That didn't work. Try again." }));
}

async function load() {
  const r = await api("today");
  if (r.error) { msg = r.error; mode = "loading"; return draw(); }
  T = { ...r, practice: null };
  msg = r.reset ? "The bots changed since your last move, so today's game started over." : "";
  mode = "game"; seen = T.view.history.length;   // a game reloaded in progress doesn't replay old results
  draw();
}

async function practice() {
  if (busy) return;
  busy = true; msg = ""; draw();
  const r = await api("practice/new", {});
  busy = false;
  if (r.error) { msg = r.error; return draw(); }
  T = { day: T.day, n: r.n, view: r.view, field: null, practice: r.practice }; seen = T.view.history.length; draw();
}

async function send(action) {
  if (busy || !T) return;
  busy = true; msg = ""; draw();
  const r = T.practice ? await api("practice/act", { id: T.practice, n: T.n, action }) : await api("act", { day: T.day, n: T.n, action });
  busy = false;
  if (r.view) T = { day: T.day, n: r.n, view: r.view, field: r.field, practice: T.practice };   // a refused move still brings the game as it is
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
    const text = `Daily Pitch save code\r\n\r\n  ${newCode}\r\n\r\nOn any browser: open ${location.origin}, open Account, and use this code under "Log in on this device".\r\nIt works in the other 88x31 games too. Keep it private: anyone with it can log in as you.\r\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = "daily-pitch-save-code.txt";
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  async use() { const code = (document.getElementById("codein")?.value || "").trim(); const r = await api("load", { code }); if (r.error) return openAccount(r.error); await changed("Logged in."); },
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
  const v = T.view;
  if (k === "go") { if (pending()) { seen = v.history.length; msg = ""; draw(); } return; }
  if (k === "practice" && v.over) return practice();
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
load();
