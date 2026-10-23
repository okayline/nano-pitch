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
  const follow = hand.filter((c) => suitOf(c) === led);
  if (!follow.length) return hand.slice();   // can't follow: play anything
  return hand.filter((c) => suitOf(c) === led || suitOf(c) === trump);   // otherwise follow, or trump
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
// Tuned by simulation (bots only, 6000 hands, no real play): all four seats bid their estimate, so no seat is a pushover
// or a gambler. A bold seat (one over its count) pitched half the hands and scored the worst; every seat now scores about the same.

export const GAME_MIN = 15; // card points in the whole hand that make the Game point likely

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

// The table's memory of bids. A hand is filed by its type: the points it expects in its best suit, how many cards that suit
// has, and the bid it faced (the highest so far). memory = { "2-3-0": { 0: n, 2: n, 3: n, 4: n }, ... }: how many players made
// each bid holding that type. A bot follows the crowd once CROWD_MIN players have held its type.
export const CROWD_MIN = 5;
export function crowdKey(hand, high) {
  const suit = bestSuit(hand);
  return `${estimate(hand, suit)}-${hand.filter((c) => suitOf(c) === suit).length}-${high}`;
}

// The crowd's bids for this type of hand, if enough players have held it for a bot to follow them; else null.
export function crowdSeen(hand, high, memory, persona = null) {
  const seen = memory && memory[crowdKey(hand, high)];
  return seen && [0, 2, 3, 4].reduce((n, b) => n + (seen[b] || 0), 0) >= (PERSONAS[persona]?.crowdMin ?? CROWD_MIN) ? seen : null;
}

// The three bot personalities, and what sets them apart in the bidding (only there). lean: how far its own count is shifted
// (the snail plays it safe; the moai goes from 3 straight to 4); crowdMin: how many players must have held a type before it
// follows the table (the ice cube trusts the crowd sooner).
export const PERSONAS = [{ lean: -1 }, { lean: 1 }, { crowdMin: 3 }];   // a bot with none bids by its own count and the crowd

// Names like aura-farm's: gen-z slang, two words ("Cracked Goblin"), the same lists (aura-farm src/names.js, copied), only the
// pairs of 12 characters or fewer so a name fits on one line in a seat and a scoreboard card.
const ADJECTIVES = [
  "Rizzed", "Unbothered", "Sigma", "Based", "Bussin", "Mewing", "Goated", "Lowkey", "Highkey", "Sus",
  "Cracked", "Iconic", "Slay", "Ohio", "Skibidi", "Chill", "Cooked", "Glazed", "Aura", "Drippy",
  "Yappy", "Extra", "Bougie", "Cozy", "Certified", "Rare", "Main", "Gyatt", "Lit", "Dank",
  "Yeet", "Clutch",
];
const NOUNS = [
  "Goblin", "NPC", "Rizzler", "Icon", "Legend", "Bestie", "Baddie", "Yapper", "Mogger", "Farmer",
  "Opp", "Stan", "Himbo", "Girlboss", "Goat", "Gamer", "Lurker", "Ghost", "Noob", "Sidekick",
  "Tryhard", "Enjoyer", "Ratio",
];
const PAIRS = ADJECTIVES.flatMap((a) => NOUNS.map((n) => `${a} ${n}`)).filter((s) => s.length <= 12);

// The profile pics: the bots draw theirs from these each game, and a player picks theirs from them (the Worker checks it).
export const PFP_POOL = ["😎", "🐸", "🦊", "🐙", "🦄", "🐲", "👻", "🤖", "👽", "🐱", "🐶", "🦉", "🐧", "🍄", "🌵", "🔥", "💎", "🎲", "🃏", "🍕", "🌮", "🧃", "🪩", "🛸", "🐌", "🗿", "🧊", "🙂"];

// One name from a random source `r` (a function giving [0, 1)); the Worker uses it too, for players' names.
export function gamerTag(r) {
  return PAIRS[Math.floor(r() * PAIRS.length)];
}

// Who sits where in a game: seats 1 to 3 each draw a personality (or none) and a name, all from the game's seed, so the same
// game always seats the same three and another game seats others. The draws are independent: a table can have two safe
// bots, or no personality at all. The profile pic is its own draw, three different ones, whatever the personality.
// cast[seat] = { persona (null: none), pfp, name }.
export function castOf(seed) {
  const r = rng(seed + ":cast"), names = [], pics = [];
  const order = [0, 1, 2].map(() => [null, 0, 1, 2][Math.floor(r() * 4)]);
  while (names.length < 3) {
    const name = gamerTag(r);
    if (!names.includes(name)) names.push(name);
  }
  while (pics.length < 3) { const e = PFP_POOL[Math.floor(r() * PFP_POOL.length)]; if (!pics.includes(e)) pics.push(e); }
  return [null, ...order.map((persona, i) => ({ persona, pfp: pics[i], name: names[i] }))];
}

// 0 to pass, or a bid that beats `high`: the crowd's most common bid for this type of hand if it has enough players
// (a tie goes to the lower bid), else the bot's own count.
export function botBid(hand, high, memory = null, persona = null) {
  const seen = crowdSeen(hand, high, memory, persona);
  if (seen) {
    let best = 0;
    for (const b of [2, 3, 4]) if ((seen[b] || 0) > (seen[best] || 0)) best = b;
    return best === 0 || best > high ? best : 0;
  }
  const est = estimate(hand, bestSuit(hand)), lean = PERSONAS[persona]?.lean ?? 0;
  const want = Math.min(4, est + (lean > 0 && est < 3 ? 0 : lean));   // bidding over only starts at a count of 3: mogger99 bids 2, or goes straight to 4
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

export function start(seed, dealerSeat, memory = null, cast = null) {
  const dealt = deal(seed), hands = dealt.hands, dealer = dealerSeat ?? dealt.dealer;
  return advance({
    seed, dealer, memory, cast, dealt: hands.map((h) => h.slice()), hands,
    bids: [], phase: "bid", turn: (dealer + 1) % 4,
    pitcher: null, bid: 0, trump: null, trick: [], tricks: [], result: null,
  });
}

function pushBid(s, seat, bid, forced = false, crowd = false) {
  s.bids.push(forced ? { seat, bid, forced: true } : crowd ? { seat, bid, crowd: true } : { seat, bid });   // crowd: the bot bid what the table remembered
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
      const high = Math.max(0, ...s.bids.map((b) => b.bid)), persona = s.cast?.[s.turn]?.persona ?? null;
      pushBid(s, s.turn, botBid(s.hands[s.turn], high, s.memory, persona), false, !!crowdSeen(s.hands[s.turn], high, s.memory, persona));
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

// ---------- the game ----------
// A day is one game: hands are dealt in turn, the dealer moving one seat clockwise each time, until a seat has 11 points
// and nobody else has as many. If two seats tie at the top, another hand is dealt. Hand 0 is the day's deal itself; hand n
// is dealt from `seed:hn`. A game = { seed, no, totals, history, hand, over }: `hand` is the hand being played (or, when
// the game is over, the last one) and `history` holds a summary of each finished hand. Plain JSON, like a hand.

export const TARGET = 11;

const handSeed = (seed, no) => (no === 0 ? seed : `${seed}:h${no}`);
const dealerOf = (seed, no) => (deal(seed).dealer + no) % 4;

// The seat that has won, or null while the game goes on.
export function leader(totals) {
  const top = Math.max(...totals);
  const at = totals.flatMap((t, seat) => (t === top ? [seat] : []));
  return top >= TARGET && at.length === 1 ? at[0] : null;
}

// What happened in a finished hand, with the cards behind HIGH, LOW and JACK.
function summary(s, no) {
  const r = s.result;
  const plays = s.tricks.flatMap((t) => t.plays).filter((p) => suitOf(p.card) === s.trump);
  const card = (seat, c) => ({ seat, card: c });
  const hi = plays.reduce((a, p) => (rankOf(p.card) > rankOf(a.card) ? p : a));
  const lo = plays.reduce((a, p) => (rankOf(p.card) < rankOf(a.card) ? p : a));
  const jack = plays.find((p) => rankOf(p.card) === 11);
  // What the human did at the bidding, for the table's memory (not their forced 2 as dealer, which wasn't a choice).
  const at = s.bids.findIndex((b) => b.seat === HUMAN), mine = s.bids[at];
  const crowd = mine.forced ? null : { key: crowdKey(s.dealt[HUMAN], Math.max(0, ...s.bids.slice(0, at).map((b) => b.bid))), bid: mine.bid };
  return {
    no, crowd, dealer: s.dealer, trump: s.trump, pitcher: s.pitcher, bid: s.bid, made: r.made, points: r.points, final: r.final,
    high: card(r.high, hi.card), low: card(r.low, lo.card), jack: jack ? card(r.jack, jack.card) : null,
    gameWinner: r.gameWinner, gameTotals: r.gameTotals,
    bids: s.bids, tricks: s.tricks,   // every bid and card in order, so the page can play the hand's last moves back
  };
}

// `memory` is the table's memory of bids as it stood when the day began; the bots in every hand of the game use it.
export function startGame(seed, memory = null) {
  const cast = castOf(seed);
  return { seed, cast, no: 0, totals: [0, 0, 0, 0], history: [], memory, hand: start(seed, dealerOf(seed, 0), memory, cast), over: false };
}

// The human's move in the game. Returns a new game; throws if illegal or the game is over.
export function actGame(game, action) {
  if (game.over) throw new Error("The game is over.");
  const g = structuredClone(game);
  g.hand = act(g.hand, action);
  if (g.hand.phase !== "done") return g;
  g.history.push(summary(g.hand, g.no));
  g.totals = g.totals.map((t, seat) => t + g.hand.result.final[seat]);
  if (leader(g.totals) !== null) { g.over = true; return g; }
  g.no++;
  g.hand = start(handSeed(g.seed, g.no), dealerOf(g.seed, g.no), g.memory, g.cast);
  return g;
}

// Rebuild a game from the seed and the human's actions, in order, across all its hands.
export function replayGame(seed, actions, memory = null) {
  let g = startGame(seed, memory);
  for (const a of actions) g = actGame(g, a);
  return g;
}

// What the human's screen may see of the game: the current hand, the running totals and the finished hands.
export function viewGame(g) {
  return {
    ...view(g.hand), cast: g.cast, no: g.no, totals: g.totals, history: g.history, over: g.over, target: TARGET,
    place: g.over ? 1 + g.totals.filter((t) => t > g.totals[HUMAN]).length : null,
  };
}
