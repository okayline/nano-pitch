// Tests for the Pitch rules and bots. Expected values are worked out by hand or with node:crypto, not from the code under test.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  HUMAN, cardCode, cardFromCode, gamePoints, deal, shuffledDeck, bidOptions, isForced, legalPlays, trickWinner,
  gameWinnerOf, scoreHand, estimate, bestSuit, botBid, botPlay, start, act, advance, view, suitOf,
  TARGET, CROWD_MIN, crowdKey, leader, startGame, actGame, replayGame, viewGame, castOf, PFP_POOL,
} from "../public/engine/pitch.js";
import { dailySeed, gameSeed } from "../engine/daily.js";

const C = (codes) => codes.split(" ").map(cardFromCode);
const H = 2; // hearts, as a suit number

test("card codes and game points", () => {
  assert.equal(cardCode(0), "2C");
  assert.equal(cardCode(51), "AS");
  assert.equal(cardFromCode("TD"), 13 + 8); // diamonds start at 13; a ten is rank 10, so offset 8
  assert.equal(cardCode(cardFromCode("JH")), "JH");
  assert.deepEqual(C("TC AC KC QC JC 9C").map(gamePoints), [10, 4, 3, 2, 1, 0]);
});

test("the deal: 4 distinct hands of 6, the same for the same seed, different for another", () => {
  const a = deal("seed-a");
  const flat = a.hands.flat();
  assert.equal(a.hands.every((h) => h.length === 6), true);
  assert.equal(new Set(flat).size, 24);
  assert.ok(a.dealer >= 0 && a.dealer <= 3);
  assert.deepEqual(deal("seed-a"), a);
  assert.notDeepEqual(deal("seed-b").hands, a.hands);
  assert.deepEqual([...shuffledDeck("x")].sort((p, q) => p - q), Array.from({ length: 52 }, (_, i) => i));
});

test("bids: each must beat the last, the dealer is forced to bid 2 when the first three pass", () => {
  assert.deepEqual(bidOptions([], 0, 1), [0, 2, 3, 4]);
  assert.deepEqual(bidOptions([{ seat: 1, bid: 3 }], 0, 2), [0, 4]);
  assert.deepEqual(bidOptions([{ seat: 1, bid: 4 }], 0, 2), [0]);
  const passes = [{ seat: 1, bid: 0 }, { seat: 2, bid: 0 }, { seat: 3, bid: 0 }];
  assert.equal(isForced(passes, 0, 0), true);
  assert.deepEqual(bidOptions(passes, 0, 0), [2]);
  assert.equal(isForced(passes.slice(0, 2), 0, 3), false);
  // the dealer is not forced when somebody bid
  assert.equal(isForced([{ seat: 1, bid: 0 }, { seat: 2, bid: 2 }, { seat: 3, bid: 0 }], 0, 0), false);
});

test("a forced bid is made for the dealer and they pitch", () => {
  const hands = [C("2C 3C 4C 5C 6C 7C"), C("2D 3D 4D 5D 6D 7D"), C("2H 3H 4H 5H 6H 7H"), C("2S 3S 4S 5S 6S 7S")];
  const s = { seed: "t", dealer: 0, dealt: hands, hands, bids: [{ seat: 1, bid: 0 }, { seat: 2, bid: 0 }, { seat: 3, bid: 0 }], phase: "bid", turn: 0, pitcher: null, bid: 0, trump: null, trick: [], tricks: [], result: null };
  advance(s);
  assert.equal(s.bids[3].bid, 2);
  assert.equal(s.bids[3].forced, true);
  assert.equal(s.pitcher, 0);
  assert.equal(s.bid, 2);
  assert.equal(s.phase, "play");
  assert.equal(s.turn, HUMAN); // the pitcher leads and the human is waiting
});

test("legal plays: follow or trump, anything if you can't follow, the leader plays anything", () => {
  const led = [{ seat: 0, card: cardFromCode("3S") }];
  assert.deepEqual(legalPlays(C("AS 5S 9H 2D"), led, H), C("AS 5S 9H")); // follow, or trump even when you could follow
  assert.deepEqual(legalPlays(C("9H 2D 4H"), led, H), C("9H 2D 4H")); // can't follow: anything, trump or not
  assert.deepEqual(legalPlays(C("2D 3C"), led, H), C("2D 3C")); // neither: anything
  assert.deepEqual(legalPlays(C("AH 3S"), [{ seat: 0, card: cardFromCode("5H") }], H), C("AH")); // trump led
  assert.deepEqual(legalPlays(C("AH 3S"), [], H), C("AH 3S"));
});

test("trick winner: highest trump, else highest of the suit led", () => {
  assert.equal(trickWinner([{ seat: 0, card: cardFromCode("AS") }, { seat: 1, card: cardFromCode("2H") }], H), 1);
  assert.equal(trickWinner([{ seat: 2, card: cardFromCode("5S") }, { seat: 3, card: cardFromCode("KS") }, { seat: 0, card: cardFromCode("AD") }], H), 3);
  assert.equal(trickWinner([{ seat: 1, card: cardFromCode("9H") }, { seat: 2, card: cardFromCode("2H") }, { seat: 3, card: cardFromCode("JH") }], H), 3);
});

test("game point: most card points, a tie gives it to nobody", () => {
  assert.equal(gameWinnerOf([27, 10, 9, 12]), 0);
  assert.equal(gameWinnerOf([12, 27, 27, 0]), null);
});

// Six tricks worked out by hand, trump hearts, seat 1 the pitcher.
// Hearts played: AH KH QH JH TH 9H 5H 4H 2H. High = AH, played by seat 1. Low = 2H, played by seat 3 (the Low point is
// theirs) in a trick that seat 2 won with 9H. Jack = JH, played by seat 0 in a trick seat 1 won with KH.
// Card points per trick: 4, 10, 6, 17, 9, 12 (58 in all). Seat 1 won tricks 1, 3, 4 = 27, so Game is seat 1's.
const play = (s, codes) => codes.split(" ").map((code, i) => ({ seat: (s + i) % 4, card: cardFromCode(code) }));
const TRICKS = [
  { plays: play(1, "AH 6D 7D 8D"), winner: 1 },
  { plays: play(1, "4C 9H 2H TC").map((p, i) => ({ ...p, seat: [1, 2, 3, 0][i] })), winner: 2 },
  { plays: play(2, "QS 3S JH KH"), winner: 1 },
  { plays: play(1, "AS KS TS 6S"), winner: 1 },
  { plays: play(1, "QC KC AC 7C"), winner: 3 },
  { plays: play(3, "5H QH 4H TH"), winner: 0 },
];

test("scoring a hand: High, Low (to the seat that played it), Jack, Game", () => {
  // trick 3 was led by seat 2: seats 2, 3, 0, 1 played QS 3S JH KH, so the jack (third card) is seat 0's
  const r = scoreHand(TRICKS, H, 1, 3);
  assert.equal(r.high, 1);
  assert.equal(r.low, 3);   // seat 3 played the 2; seat 2 took that trick and its card points
  assert.equal(r.jack, 1);
  assert.deepEqual(r.gameTotals, [12, 27, 10, 9]);
  assert.equal(r.gameWinner, 1);
  assert.deepEqual(r.points, [0, 3, 0, 1]);
  assert.equal(r.made, true);
  assert.deepEqual(r.final, [0, 3, 0, 1]);
});

test("a bid that isn't made is set: the pitcher loses the bid, everyone else keeps what they took", () => {
  const r = scoreHand(TRICKS, H, 1, 4);
  assert.equal(r.made, false);
  assert.deepEqual(r.points, [0, 3, 0, 1]);
  assert.deepEqual(r.final, [0, -4, 0, 1]);
});

test("estimating a hand by hand", () => {
  // hearts: ace (1) + jack with the ace (1); no 2 or 3 of hearts; card points 4 + 1 = 5, under the Game line
  assert.equal(estimate(C("AH JH 9H 2D 3C 4C"), H), 2);
  // hearts: ace, jack, the 2 (Low goes to whoever plays it) = 3; card points AH 4 + JH 1 + TD 10 + TC 10 + KS 3 = 28 = Game: 4
  assert.equal(estimate(C("AH 2H JH TD TC KS"), H), 4);
  // a lone jack with a low card and no ace or king counts for nothing
  assert.equal(estimate(C("JH 5D 6D 7C 8C 9S"), H), 0);
  // a lone 2 or 3 of trump counts for the Low point, with nothing else behind it
  assert.equal(estimate(C("2H 5D 6D 7C 8C 9S"), H), 1);
  assert.equal(estimate(C("3H 5D 6D 7C 8C 9S"), H), 1);
  assert.equal(estimate(C("4H 5D 6D 7C 8C 9S"), H), 0);
});

test("best suit: most points, then most cards, then the lowest suit", () => {
  assert.equal(bestSuit(C("AH 9H 2H KS 3C 4D")), H);
  assert.equal(bestSuit(C("2C 3C 4D 5D 6H 7S")), 0); // all zero, clubs and diamonds tie on length, clubs is lower
  assert.equal(bestSuit(C("2C 3C 4C 5D 6D 7S")), 0); // clubs: three cards
});

test("bot bids: its estimate, only if it beats the bid and is at least 2", () => {
  const two = C("AH JH 9H 2D 3C 4C"); // estimate 2
  assert.equal(botBid(two, 0), 2);
  assert.equal(botBid(two, 2), 0); // can't beat 2 with 2
  assert.equal(botBid(C("JH 5D 6D 7C 8C 9S"), 0), 0); // under 2: pass
  assert.equal(botBid(C("AH 2H JH TD TC KS"), 0), 4); // ace, low, jack and game
});

test("bot personalities: lagspike plays safe, mogger99 goes from 3 to 4, tiltproof trusts the crowd sooner", () => {
  const three = C("AH 2H JH 5D 6C 7S"); // estimate 3
  const two = C("AH JH 9H 2D 3C 4C");   // estimate 2
  assert.deepEqual([null, 0, 1, 2].map((p) => botBid(three, 0, null, p)), [3, 2, 4, 3]);
  assert.deepEqual([null, 0, 1, 2].map((p) => botBid(two, 0, null, p)), [2, 0, 2, 2]);   // mogger99 leans only from a count of 3
  const mem = { [crowdKey(two, 0)]: { 0: 3 } };   // three players passed this type of hand
  assert.equal(botBid(two, 0, mem, 0), 0);   // lagspike: under 5 players, its own count... which, being careful, is a pass
  assert.equal(botBid(two, 0, mem, 1), 2);   // mogger99: own count
  assert.equal(botBid(two, 0, mem, 2), 0);   // tiltproof: three players are enough to follow
});

test("the cast: each bot draws a personality (or none) and a name from the game's seed", () => {
  assert.deepEqual(castOf("g1"), castOf("g1"));   // the same game always seats the same three
  const seatings = new Set(), names = new Set(); let doubled = 0;
  for (let i = 0; i < 60; i++) {
    const c = castOf("seed-" + i);
    assert.equal(c[0], null);
    const ps = c.slice(1).map((x) => x.persona);
    assert.ok(ps.every((p) => p === null || [0, 1, 2].includes(p)));
    if (new Set(ps).size < 3) doubled++;   // two bots can share a personality
    assert.equal(new Set(c.slice(1).map((x) => x.name)).size, 3);           // three different names
    assert.equal(new Set(c.slice(1).map((x) => x.pfp)).size, 3);            // and three different profile pics
    for (const x of c.slice(1)) { assert.ok(PFP_POOL.includes(x.pfp)); assert.match(x.name, /^[A-Z][A-Za-z]+ [A-Za-z]+$/); assert.ok(x.name.length <= 12); names.add(x.name); }
    seatings.add(ps.join(","));
  }
  assert.ok(seatings.size > 5 && names.size > 10 && doubled > 0);   // seats, repeats and names vary from game to game
  assert.ok(Array.from({ length: 400 }, (_, i) => castOf("n" + i)).some((c) => c.slice(1).every((x) => x.persona === null)));   // a table with no personality at all can happen
  const g = startGame("g1");
  assert.deepEqual(viewGame(g).cast, castOf("g1"));
});

test("the table's memory: bots follow the crowd once enough players held that type of hand", () => {
  const two = C("AH JH 9H 2D 3C 4C"); // estimate 2 in hearts, three hearts
  const key = crowdKey(two, 0);
  assert.equal(key, "2-3-0");
  assert.equal(crowdKey(two, 3), "2-3-3");   // the bid faced is part of the type
  const mem = (counts) => ({ [key]: counts });
  assert.equal(botBid(two, 0, null), 2);
  assert.equal(botBid(two, 0, mem({ 0: 4 })), 2);                // 4 players is under CROWD_MIN: the bot's own count
  assert.equal(CROWD_MIN, 5);
  assert.equal(botBid(two, 0, mem({ 0: 5 })), 0);                // five passed: it passes
  assert.equal(botBid(two, 0, mem({ 0: 2, 2: 3, 3: 4 })), 3);    // the most common bid
  assert.equal(botBid(two, 0, mem({ 2: 3, 3: 3 })), 2);          // a tie goes to the lower bid
  assert.equal(botBid(two, 0, mem({ 0: 3, 2: 3 })), 0);          // ...which is a pass against a bid
  assert.equal(botBid(two, 3, mem({ 3: 9 })), 0);                // that memory is for bid 0; against a 3 it's another type, and 2 can't beat 3
  const other = { [crowdKey(two, 2)]: { 2: 9 } };
  assert.equal(botBid(two, 2, other), 0);                         // a crowd bid that can't beat the bid faced is a pass
});

test("a game with a memory replays the same, and each hand notes the human's bid for the memory", () => {
  const mem = {};
  for (let i = 0; i < 20; i++) { // a memory that makes every bot hand of type "2-3-0" bid 3, so it changes play
    const g = startGame("m-" + i);
    mem[crowdKey(g.hand.dealt[1], 0)] = { 3: 9 };
  }
  for (let i = 0; i < 10; i++) {
    const seed = "m-" + i;
    const { g, actions } = (() => {
      let g = startGame(seed, mem); const actions = [];
      while (!g.over) { const v = viewGame(g); const a = v.phase === "bid" ? { type: "bid", bid: v.bidOptions[0] } : { type: "play", card: v.legal[0] }; actions.push(a); g = actGame(g, a); }
      return { g, actions };
    })();
    assert.deepEqual(replayGame(seed, actions, mem), g);
    for (const h of g.history) {
      if (h.crowd === null) assert.equal(h.bid >= 2, true);      // forced as dealer
      else assert.match(h.crowd.key, /^\d-\d-\d$/);
    }
  }
  // the human's note matches what they bid and what they faced
  const { g } = (() => { let g = startGame("seed-5"); while (!g.over) { const v = viewGame(g); g = actGame(g, v.phase === "bid" ? { type: "bid", bid: v.bidOptions[0] } : { type: "play", card: v.legal[0] }); } return { g }; })();
  assert.ok(g.history.some((h) => h.crowd));
  for (const h of g.history) if (h.crowd) assert.ok([0, 2, 3, 4].includes(h.crowd.bid));
});

test("bot plays: lead, follow cheaply for a point card, dump the lowest otherwise", () => {
  // the pitcher's first lead is its highest card of its best suit
  assert.equal(botPlay({ seat: 1, hand: C("AH 9H 2H KS 3C 4D"), trick: [], trump: null, pitcher: 1 }), cardFromCode("AH"));
  // a trump jack is in the trick: win it with the cheapest winner (QH, not AH)
  assert.equal(botPlay({ seat: 2, hand: C("QH AH 5S"), trick: [{ seat: 1, card: cardFromCode("JH") }], trump: H, pitcher: 1 }), cardFromCode("QH"));
  // nothing worth winning: dump the lowest plain card (9C), not the trump 2H
  assert.equal(botPlay({ seat: 2, hand: C("9C KC 2H 3D"), trick: [{ seat: 1, card: cardFromCode("5C") }], trump: H, pitcher: 1 }), cardFromCode("9C"));
  // a ten is in the trick: win it as cheaply as possible (KC), not with a trump
  assert.equal(botPlay({ seat: 2, hand: C("KC 3C AH"), trick: [{ seat: 1, card: cardFromCode("TC") }], trump: H, pitcher: 1 }), cardFromCode("KC"));
  // a single legal card is just played
  assert.equal(botPlay({ seat: 2, hand: C("3C 2D"), trick: [{ seat: 0, card: cardFromCode("TC") }, { seat: 1, card: cardFromCode("AC") }], trump: H, pitcher: 1 }), cardFromCode("3C"));
});

// Plays the first allowed bid (pass, or the forced 2) and the first legal card, recording the actions.
function playOut(seed) {
  let s = start(seed);
  const actions = [];
  while (s.phase !== "done") {
    const a = s.phase === "bid" ? { type: "bid", bid: bidOptions(s.bids, s.dealer, HUMAN)[0] } : { type: "play", card: view(s).legal[0] };
    actions.push(a);
    s = act(s, a);
  }
  return { s, actions };
}

test("120 seeds: every round finishes, each seat with trump plays its 6 cards once, a seat without trump sits out, points are consistent", () => {
  let sat = 0;
  for (let i = 0; i < 120; i++) {
    const { s } = playOut("seed-" + i);
    assert.equal(s.tricks.length, 6);
    const playing = [0, 1, 2, 3].filter((seat) => s.dealt[seat].some((c) => suitOf(c) === s.trump));
    assert.deepEqual(s.out, [0, 1, 2, 3].map((seat) => !playing.includes(seat)));   // sat out = dealt no trump
    assert.ok(playing.includes(s.pitcher));
    sat += 4 - playing.length;
    for (const seat of s.out.flatMap((o, k) => (o ? [k] : []))) assert.equal(s.hands[seat].length, 6);   // a seat that sat out kept all its cards
    const played = s.tricks.flatMap((t) => t.plays.map((p) => p.card));
    assert.deepEqual([...played].sort((a, b) => a - b), playing.flatMap((seat) => s.dealt[seat]).sort((a, b) => a - b));
    for (const t of s.tricks) assert.deepEqual(t.plays.map((p) => p.seat).sort(), playing.slice().sort());
    assert.equal(suitOf(s.tricks[0].plays[0].card), s.trump); // the pitcher's first lead named trump
    assert.equal(s.tricks[0].plays[0].seat, s.pitcher);
    const r = s.result;
    const given = 2 + (r.jack !== null ? 1 : 0) + (r.gameWinner !== null ? 1 : 0);
    assert.equal(r.points.reduce((a, b) => a + b, 0), given);
    assert.equal(r.gameTotals.reduce((a, b) => a + b, 0), played.reduce((n, c) => n + gamePoints(c), 0));   // only the cards played count
    assert.equal(s.tricks.flatMap((t) => t.plays).filter((p) => suitOf(p.card) === s.trump).reduce((a, p) => (p.card % 13 < a.card % 13 ? p : a)).seat, r.low);   // Low: the seat that played the lowest trump
    assert.equal(r.made, r.points[s.pitcher] >= s.bid);
    assert.ok(s.bid >= 2 && s.bid <= 4);
  }
  assert.ok(sat > 0, "some seed has a seat that sits out");
});

// Plays a whole game: the first allowed bid and the first legal card each time, recording the actions.
function playGame(seed) {
  let g = startGame(seed);
  const actions = [];
  while (!g.over) {
    const v = viewGame(g);
    const a = v.phase === "bid" ? { type: "bid", bid: v.bidOptions[0] } : { type: "play", card: v.legal[0] };
    actions.push(a);
    g = actGame(g, a);
  }
  return { g, actions };
}

test("leader: 11 or more and alone at the top; a tie at the top plays on", () => {
  assert.equal(leader([11, 3, 2, 1]), 0);
  assert.equal(leader([4, 12, 11, 0]), 1);
  assert.equal(leader([10, 9, 8, 7]), null); // nobody at 11 yet
  assert.equal(leader([11, 11, 0, 0]), null); // tied at the top
  assert.equal(leader([13, 13, 13, 2]), null);
  assert.equal(leader([-3, 11, -4, 0]), 1); // scores can go below zero
  assert.equal(TARGET, 11);
});

test("the game: hands follow one another, the dealer moves one seat each hand, hand 0 is the day's own deal", () => {
  const g0 = startGame("seed-5");
  assert.equal(g0.no, 0);
  assert.deepEqual(g0.hand.dealt, start("seed-5").dealt);
  assert.equal(g0.hand.dealer, deal("seed-5").dealer);
  const { g } = playGame("seed-5");
  assert.ok(g.history.length >= 2);
  g.history.forEach((h, i) => {
    assert.equal(h.no, i);
    assert.equal(h.dealer, (deal("seed-5").dealer + i) % 4);
  });
  // totals are the sum of every hand's final scores, and the game ended with exactly one leader
  const sum = [0, 1, 2, 3].map((seat) => g.history.reduce((n, h) => n + h.final[seat], 0));
  assert.deepEqual(g.totals, sum);
  assert.equal(g.over, true);
  assert.notEqual(leader(g.totals), null);
  // every hand before the last left nobody alone at 11
  let running = [0, 0, 0, 0];
  for (const h of g.history.slice(0, -1)) { running = running.map((t, k) => t + h.final[k]); assert.equal(leader(running), null); }
  assert.throws(() => actGame(g, { type: "bid", bid: 0 })); // a finished game takes no more moves
});

test("20 games: each finishes, and the seed plus the human's actions rebuild the same game", () => {
  for (let i = 0; i < 20; i++) {
    const seed = "game-" + i;
    const { g, actions } = playGame(seed);
    assert.deepEqual(replayGame(seed, actions), g);
    const v = viewGame(g);
    assert.equal(v.over, true);
    assert.equal(v.place, 1 + g.totals.filter((t) => t > g.totals[HUMAN]).length);
    assert.equal("hands" in v, false);
  }
});

test("a hand's summary names the cards behind HIGH, LOW and JACK", () => {
  const { g } = playGame("seed-9");
  for (const h of g.history) {
    assert.equal(suitOf(h.high.card), h.trump);
    assert.equal(suitOf(h.low.card), h.trump);
    assert.ok(h.jack === null || (suitOf(h.jack.card) === h.trump && h.jack.card % 13 === 9)); // a jack is rank 11, so c%13 is 9
    assert.equal(h.points.reduce((a, b) => a + b, 0), 2 + (h.jack ? 1 : 0) + (h.gameWinner !== null ? 1 : 0));
  }
});

test("a hand's summary carries every bid and card in order, for the page to play back", () => {
  const { g } = playGame("seed-9");
  for (const h of g.history) {
    assert.equal(h.bids.length, 4);
    assert.deepEqual(h.bids.map((b) => b.seat), [1, 2, 3, 0].map((k) => (h.dealer + k) % 4));   // left of the dealer first
    assert.equal(h.tricks.length, 6);
    const cards = h.tricks.flatMap((t) => t.plays.map((p) => p.card));
    const playing = h.out.filter((o) => !o).length;
    assert.equal(new Set(cards).size, 6 * playing);                // every seat with trump plays its 6; the others sit out
    assert.equal(h.out[h.pitcher], false);
    assert.equal(suitOf(cards[0]), h.trump);                       // the first lead names trump
    assert.equal(h.tricks[0].plays[0].seat, h.pitcher);            // and the bidder makes it
    for (const t of h.tricks) assert.equal(new Set(t.plays.map((p) => p.seat)).size, playing);
    for (let i = 1; i < 6; i++) assert.equal(h.tricks[i].plays[0].seat, h.tricks[i - 1].winner);   // a trick's winner leads the next
  }
});

test("illegal moves are refused, and the view hides the bots' cards", () => {
  // the human has a bidding turn unless they are the dealer and the dealer's bid is forced, so pick a seed that has one
  const seed = Array.from({ length: 50 }, (_, i) => "seed-" + i).find((x) => start(x).phase === "bid");
  const s = start(seed);
  assert.throws(() => act(s, { type: "play", card: s.hands[HUMAN][0] })); // bidding comes first
  assert.throws(() => act(s, { type: "bid", bid: 1 })); // not a bid
  const next = act(s, { type: "bid", bid: bidOptions(s.bids, s.dealer, HUMAN)[0] });
  assert.equal(next.phase === "play" || next.phase === "done", true);
  if (next.phase === "play") {
    assert.throws(() => act(next, { type: "bid", bid: 2 })); // bidding is over
    const missing = Array.from({ length: 52 }, (_, i) => i).find((c) => !next.hands[HUMAN].includes(c));
    assert.throws(() => act(next, { type: "play", card: missing })); // not in the hand
  }
  const v = view(s);
  assert.equal(v.hand.length, 6);
  assert.equal("hands" in v, false);
  assert.equal("dealt" in v, false);
  assert.equal("seed" in v, false);
});

test("seeds: a day's is HMAC-SHA256(secret, 'daily:' + day) and a game's is HMAC-SHA256(secret, 'game:' + number)", async () => {
  const seed = await dailySeed("s3cret", "2026-10-22");
  assert.equal(seed, createHmac("sha256", "s3cret").update("daily:2026-10-22").digest("hex"));
  assert.notEqual(seed, await dailySeed("s3cret", "2026-10-23"));
  assert.notEqual(seed, await dailySeed("other", "2026-10-22"));
  const g = await gameSeed("s3cret", 7);   // a game's seed: HMAC-SHA256(secret, "game:7")
  assert.equal(g, createHmac("sha256", "s3cret").update("game:7").digest("hex"));
  assert.notEqual(g, await gameSeed("s3cret", 8));
  assert.notEqual(g, await gameSeed("other", 7));
  await assert.rejects(() => gameSeed("", 7));
  await assert.rejects(() => gameSeed("s3cret", 0));
  await assert.rejects(() => gameSeed("s3cret", 1.5));
  await assert.rejects(() => dailySeed("", "2026-10-22"));
  await assert.rejects(() => dailySeed("s3cret", "22-10-2026"));
});
