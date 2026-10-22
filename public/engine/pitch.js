// Daily Pitch: the rules and the bots, in one file loaded by the Worker, the page and the tests.
//
// One hand of 4-point cutthroat Pitch. Four seats, 6 cards each from one 52-card deck (the other 28 are unused).
// Seat 0 is the human; seats 1 to 3 are rule bots. The deal comes from the day's seed, so everyone gets the same
// cards and the same bot hands. Bots follow fixed rules with no randomness and see only their own hand and what
// has been played, so the seed plus the human's actions rebuild the whole hand (`replay`).
//
// Cards are integers 0..51: suit = floor(c / 13) in SUITS order (C D H S), rank = c % 13 + 2 (11 J, 12 Q, 13 K, 14 A).

export const HUMAN = 0;
export const HAND = 6;

// ---------- seeded randomness (same generator as scoundrel.exe: cyrb128 + sfc32) ----------

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(a, b, c, d) {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function rng(seed) {
  const r = sfc32(...cyrb128(String(seed)));
  for (let i = 0; i < 15; i++) r(); // warm up
  return r;
}

// ---------- cards ----------

export const SUITS = ["C", "D", "H", "S"];
export const suitOf = (c) => Math.floor(c / 13);
export const rankOf = (c) => (c % 13) + 2;
export const makeCard = (suit, rank) => suit * 13 + rank - 2;

const RANK_CODE = { 10: "T", 11: "J", 12: "Q", 13: "K", 14: "A" };
const CODE_RANK = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
export const cardCode = (c) => (RANK_CODE[rankOf(c)] ?? String(rankOf(c))) + SUITS[suitOf(c)]; // "TD", "AS", "2H"
export const cardFromCode = (code) => makeCard(SUITS.indexOf(code[1]), CODE_RANK[code[0]] ?? Number(code[0]));

// Card points for the Game point: 10 = 10, A = 4, K = 3, Q = 2, J = 1.
export const gamePoints = (c) => ({ 10: 10, 14: 4, 13: 3, 12: 2, 11: 1 })[rankOf(c)] ?? 0;

export function shuffledDeck(seed) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const r = rng(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// The deal: seat s gets cards s*6 .. s*6+5 of the shuffle (sorted for display); the dealer is its own draw.
export function deal(seed) {
  const deck = shuffledDeck(seed);
  const hands = [0, 1, 2, 3].map((s) => deck.slice(s * HAND, s * HAND + HAND).sort((a, b) => a - b));
  const dealer = Math.floor(rng(seed + ":dealer")() * 4);
  return { hands, dealer };
}

// ---------- bidding ----------

// Bids go left of the dealer first and the dealer last, each seat once. A bid must beat the one before it. If the
// first three pass, the dealer has to bid 2.
export const isForced = (bids, dealer, seat) => seat === dealer && bids.length === 3 && bids.every((b) => b.bid === 0);

export function bidOptions(bids, dealer, seat) {
  if (isForced(bids, dealer, seat)) return [2];
  const high = Math.max(0, ...bids.map((b) => b.bid));
  const out = [0];
  for (let b = 2; b <= 4; b++) if (b > high) out.push(b);
  return out;
}

// ---------- play ----------

// Follow the suit that was led or play a trump (trumping is allowed even when you could follow); if you can do
// neither, play anything. The leader may play anything.
export function legalPlays(hand, trick, trump) {
  if (trick.length === 0) return hand.slice();
  const led = suitOf(trick[0].card);
  const legal = hand.filter((c) => suitOf(c) === led || suitOf(c) === trump);
  return legal.length ? legal : hand.slice();
}

// Highest trump wins; with no trump, the highest card of the suit led.
export function trickWinner(plays, trump) {
  const led = suitOf(plays[0].card);
  const strength = (p) => (suitOf(p.card) === trump ? 100 : suitOf(p.card) === led ? 0 : -100) + rankOf(p.card);
  let best = plays[0];
  for (const p of plays) if (strength(p) > strength(best)) best = p;
  return best.seat;
}

// The Game point goes to the most card points; a tie gives it to nobody.
export function gameWinnerOf(totals) {
  const top = Math.max(...totals);
  const at = totals.flatMap((t, s) => (t === top ? [s] : []));
  return at.length === 1 ? at[0] : null;
}

// Scores a finished hand. tricks: [{ plays: [{ seat, card }], winner }].
//   High: the seat that played the highest trump.  Low: the seat that WON THE TRICK holding the lowest trump played.
//   Jack: the seat that won the trick holding the jack of trump (if it was dealt).  Game: most card points won.
// The pitcher scores what they took if they took at least their bid, otherwise loses the bid.
export function scoreHand(tricks, trump, pitcher, bid) {
  const trumpPlays = [];
  for (const t of tricks) for (const p of t.plays) if (suitOf(p.card) === trump) trumpPlays.push({ ...p, winner: t.winner });
  const high = trumpPlays.reduce((a, p) => (rankOf(p.card) > rankOf(a.card) ? p : a));
  const low = trumpPlays.reduce((a, p) => (rankOf(p.card) < rankOf(a.card) ? p : a));
  const jack = trumpPlays.find((p) => rankOf(p.card) === 11) || null;
  const gameTotals = [0, 0, 0, 0];
  for (const t of tricks) for (const p of t.plays) gameTotals[t.winner] += gamePoints(p.card);
  const gameWinner = gameWinnerOf(gameTotals);
  const points = [0, 0, 0, 0];
  points[high.seat]++;
  points[low.winner]++;
  if (jack) points[jack.winner]++;
  if (gameWinner !== null) points[gameWinner]++;
  const made = points[pitcher] >= bid;
  const final = points.slice();
  if (!made) final[pitcher] = -bid;
  return { points, final, made, high: high.seat, low: low.winner, jack: jack ? jack.winner : null, gameWinner, gameTotals };
}

// ---------- the bots ----------
// All of this is my first guess (not tested against real play); the numbers are in one place so they can be tuned.

export const GAME_MIN = 15; // card points in the whole hand that make the Game point likely
export const BOT_OFFSET = [0, -1, 0, 1]; // by seat: a cautious bot bids one under its count, a bold one one over

// Points a hand can expect with `suit` as trump.
export function estimate(hand, suit) {
  const cards = hand.filter((c) => suitOf(c) === suit);
  const has = (rank) => cards.includes(makeCard(suit, rank));
  const high = has(14) ? 1 : 0;
  // A lone jack gets captured: it counts with the ace or king, or three or more trump.
  const jack = has(11) && (has(14) || has(13) || cards.length >= 3) ? 1 : 0;
  // Low goes to whoever wins the trick holding the lowest trump, so a small trump only counts with the ace behind it.
  const low = (has(2) || has(3)) && has(14) ? 1 : 0;
  const game = hand.reduce((n, c) => n + gamePoints(c), 0) >= GAME_MIN ? 1 : 0;
  return high + jack + low + game;
}

// The suit a bot would call trump: the highest estimate, then the most cards in it, then the lowest suit.
// Bidding and the first lead both use this, so a bot pitches the suit it bid on.
export function bestSuit(hand) {
  let best = null;
  for (let suit = 0; suit < 4; suit++) {
    const cand = { suit, est: estimate(hand, suit), len: hand.filter((c) => suitOf(c) === suit).length };
    if (!best || cand.est > best.est || (cand.est === best.est && cand.len > best.len)) best = cand;
  }
  return best.suit;
}

// 0 to pass, or a bid that beats `high`.
export function botBid(hand, seat, high) {
  const want = Math.min(4, estimate(hand, bestSuit(hand)) + BOT_OFFSET[seat]);
  return want >= 2 && want > high ? want : 0;
}

const byHigh = (a, b) => rankOf(b) - rankOf(a) || suitOf(a) - suitOf(b);
const byLow = (a, b) => rankOf(a) - rankOf(b) || suitOf(a) - suitOf(b);

// Which card a bot plays. v: { seat, hand, trick, trump, pitcher }.
export function botPlay(v) {
  const { seat, hand, trick, trump, pitcher } = v;
  const legal = legalPlays(hand, trick, trump);
  if (legal.length === 1) return legal[0];
  const isTrump = (c) => suitOf(c) === trump;
  const guarded = (c) => rankOf(c) === 10 || (isTrump(c) && rankOf(c) === 11); // its own tens and trump jack
  // Dumping order: plain cards before trumps, then lowest rank, then lowest suit.
  const dump = (a, b) => (isTrump(a) ? 1 : 0) - (isTrump(b) ? 1 : 0) || byLow(a, b);

  if (trick.length === 0) {
    if (trump === null) { // the pitcher's first lead names trump: its highest card of its best suit
      const suit = bestSuit(hand);
      const mine = hand.filter((c) => suitOf(c) === suit);
      return (mine.length ? mine : hand).sort(byHigh)[0];
    }
    const trumps = hand.filter(isTrump);
    if (trumps.length && (seat === pitcher || trumps.some((c) => rankOf(c) === 14))) return trumps.sort(byHigh)[0];
    const plain = hand.filter((c) => !guarded(c) && !isTrump(c));
    const pool = plain.length ? plain : hand.filter((c) => !guarded(c));
    return (pool.length ? pool : hand).sort(byLow)[0];
  }

  // Following: if the trick holds a point card (a ten, the trump jack, a very low trump), win it as cheaply as possible.
  const point = trick.some((p) => rankOf(p.card) === 10 || (suitOf(p.card) === trump && (rankOf(p.card) === 11 || rankOf(p.card) <= 3)));
  if (point) {
    const winners = legal.filter((c) => trickWinner([...trick, { seat, card: c }], trump) === seat);
    if (winners.length) return winners.sort(dump)[0];
  }
  const open = legal.filter((c) => !guarded(c));
  return (open.length ? open : legal).sort(dump)[0];
}

// ---------- the hand ----------
// state = { seed, dealer, dealt, hands, bids, phase: "bid" | "play" | "done", turn, pitcher, bid, trump, trick, tricks, result }
// Plain JSON, so the Worker can keep it. `start` and `act` hand back a state waiting on the human (or finished).

export function start(seed) {
  const { hands, dealer } = deal(seed);
  return advance({
    seed, dealer, dealt: hands.map((h) => h.slice()), hands,
    bids: [], phase: "bid", turn: (dealer + 1) % 4,
    pitcher: null, bid: 0, trump: null, trick: [], tricks: [], result: null,
  });
}

function pushBid(s, seat, bid, forced = false) {
  s.bids.push(forced ? { seat, bid, forced: true } : { seat, bid });
  s.turn = (s.turn + 1) % 4;
}

function settleBids(s) {
  const top = s.bids.reduce((a, b) => (b.bid > a.bid ? b : a));
  s.pitcher = top.seat;
  s.bid = top.bid;
  s.phase = "play";
  s.turn = top.seat;
}

function playCard(s, seat, card) {
  if (s.turn !== seat) throw new Error("Not that seat's turn.");
  if (!s.hands[seat].includes(card)) throw new Error("That card isn't in the hand.");
  if (!legalPlays(s.hands[seat], s.trick, s.trump).includes(card)) throw new Error("That card isn't legal.");
  s.hands[seat].splice(s.hands[seat].indexOf(card), 1);
  s.trick.push({ seat, card });
  if (s.trump === null) s.trump = suitOf(card); // the pitcher's first lead names trump
  if (s.trick.length < 4) { s.turn = (seat + 1) % 4; return; }
  const winner = trickWinner(s.trick, s.trump);
  s.tricks.push({ plays: s.trick, winner });
  s.trick = [];
  s.turn = winner;
  if (s.tricks.length === HAND) {
    s.phase = "done";
    s.result = scoreHand(s.tricks, s.trump, s.pitcher, s.bid);
  }
}

// Plays the bots (and the dealer's forced bid) until it is the human's turn or the hand is over. Changes `s` in place.
export function advance(s) {
  for (;;) {
    if (s.phase === "done") return s;
    if (s.phase === "bid") {
      if (s.bids.length === 4) { settleBids(s); continue; }
      if (isForced(s.bids, s.dealer, s.turn)) { pushBid(s, s.turn, 2, true); continue; }
      if (s.turn === HUMAN) return s;
      const high = Math.max(0, ...s.bids.map((b) => b.bid));
      pushBid(s, s.turn, botBid(s.hands[s.turn], s.turn, high));
      continue;
    }
    if (s.turn === HUMAN) return s;
    const seat = s.turn;
    playCard(s, seat, botPlay({ seat, hand: s.hands[seat], trick: s.trick, trump: s.trump, pitcher: s.pitcher }));
  }
}

// The human's move: { type: "bid", bid: 0 | 2 | 3 | 4 } or { type: "play", card }. Returns a new state; throws if illegal.
export function act(state, action) {
  const s = structuredClone(state);
  if (s.phase === "done") throw new Error("The hand is over.");
  if (s.turn !== HUMAN) throw new Error("It isn't the human's turn.");
  if (s.phase === "bid") {
    if (action.type !== "bid") throw new Error("Bid first.");
    if (!bidOptions(s.bids, s.dealer, HUMAN).includes(action.bid)) throw new Error("That bid isn't allowed.");
    pushBid(s, HUMAN, action.bid);
  } else {
    if (action.type !== "play") throw new Error("Play a card.");
    playCard(s, HUMAN, action.card);
  }
  return advance(s);
}

// Rebuild a hand from the seed and the human's actions.
export function replay(seed, actions) {
  let s = start(seed);
  for (const a of actions) s = act(s, a);
  return s;
}

// What the human's screen may see: their own cards, how many the bots hold, and what has been bid and played.
export function view(s) {
  const mine = s.turn === HUMAN && s.phase !== "done";
  return {
    dealer: s.dealer, phase: s.phase, turn: s.turn, hand: s.hands[HUMAN], counts: s.hands.map((h) => h.length),
    bids: s.bids, bidOptions: mine && s.phase === "bid" ? bidOptions(s.bids, s.dealer, HUMAN) : null,
    pitcher: s.pitcher, bid: s.bid, trump: s.trump, trick: s.trick, tricks: s.tricks,
    legal: mine && s.phase === "play" ? legalPlays(s.hands[HUMAN], s.trick, s.trump) : null,
    result: s.result,
  };
}
