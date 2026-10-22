// Tests for the Pitch rules and bots. Expected values are worked out by hand or with node:crypto, not from the code under test.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  HUMAN, cardCode, cardFromCode, gamePoints, deal, shuffledDeck, bidOptions, isForced, legalPlays, trickWinner,
  gameWinnerOf, scoreHand, estimate, bestSuit, botBid, botPlay, start, act, replay, advance, view, suitOf,
} from "../public/engine/pitch.js";
import { dailySeed, seedHash } from "../engine/daily.js";

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

test("legal plays: follow or trump, anything if neither, the leader plays anything", () => {
  const led = [{ seat: 0, card: cardFromCode("3S") }];
  assert.deepEqual(legalPlays(C("AS 5S 9H 2D"), led, H), C("AS 5S 9H")); // follow, or trump even when you could follow
  assert.deepEqual(legalPlays(C("9H 2D 4H"), led, H), C("9H 4H")); // can't follow: must trump
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
// Hearts played: AH KH QH JH TH 9H 5H 4H 2H. High = AH, played by seat 1. Low = 2H, played by seat 3 in a trick
// that seat 2 won with 9H. Jack = JH, played by seat 0 in a trick seat 1 won with KH.
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

test("scoring a hand: High, Low (won by the trick winner), Jack, Game", () => {
  // trick 3 was led by seat 2: seats 2, 3, 0, 1 played QS 3S JH KH, so the jack (third card) is seat 0's
  const r = scoreHand(TRICKS, H, 1, 3);
  assert.equal(r.high, 1);
  assert.equal(r.low, 2);
  assert.equal(r.jack, 1);
  assert.deepEqual(r.gameTotals, [12, 27, 10, 9]);
  assert.equal(r.gameWinner, 1);
  assert.deepEqual(r.points, [0, 3, 1, 0]);
  assert.equal(r.made, true);
  assert.deepEqual(r.final, [0, 3, 1, 0]);
});

test("a bid that isn't made is set: the pitcher loses the bid, everyone else keeps what they took", () => {
  const r = scoreHand(TRICKS, H, 1, 4);
  assert.equal(r.made, false);
  assert.deepEqual(r.points, [0, 3, 1, 0]);
  assert.deepEqual(r.final, [0, -4, 1, 0]);
});

test("estimating a hand by hand", () => {
  // hearts: ace (1) + jack with the ace (1); no 2 or 3 of hearts; card points 4 + 1 = 5, under the Game line
  assert.equal(estimate(C("AH JH 9H 2D 3C 4C"), H), 2);
  // hearts: ace, jack, the 2 behind the ace = 3; card points AH 4 + JH 1 + TD 10 + TC 10 + KS 3 = 28 = Game: 4
  assert.equal(estimate(C("AH 2H JH TD TC KS"), H), 4);
  // a lone jack with a low card and no ace or king counts for nothing
  assert.equal(estimate(C("JH 5D 6D 7C 8C 9S"), H), 0);
});

test("best suit: most points, then most cards, then the lowest suit", () => {
  assert.equal(bestSuit(C("AH 9H 2H KS 3C 4D")), H);
  assert.equal(bestSuit(C("2C 3C 4D 5D 6H 7S")), 0); // all zero, clubs and diamonds tie on length, clubs is lower
  assert.equal(bestSuit(C("2C 3C 4C 5D 6D 7S")), 0); // clubs: three cards
});

test("bot bids: by estimate plus the seat's offset, only if it beats the bid", () => {
  const two = C("AH JH 9H 2D 3C 4C"); // estimate 2
  assert.equal(botBid(two, 2, 0), 2); // offset 0
  assert.equal(botBid(two, 2, 2), 0); // can't beat 2 with 2
  assert.equal(botBid(two, 1, 0), 0); // cautious seat: 1
  assert.equal(botBid(two, 3, 0), 3); // bold seat: 3
  assert.equal(botBid(C("JH 5D 6D 7C 8C 9S"), 3, 0), 0); // 0 + 1 is under 2
  assert.equal(botBid(C("AH 2H JH TD TC KS"), 3, 0), 4); // 4 + 1 is capped at 4
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

test("120 seeds: every hand finishes, all 24 cards are played once, points are consistent", () => {
  for (let i = 0; i < 120; i++) {
    const { s } = playOut("seed-" + i);
    assert.equal(s.tricks.length, 6);
    const played = s.tricks.flatMap((t) => t.plays.map((p) => p.card));
    assert.deepEqual([...played].sort((a, b) => a - b), s.dealt.flat().sort((a, b) => a - b));
    for (const t of s.tricks) assert.equal(t.plays.length, 4);
    assert.equal(suitOf(s.tricks[0].plays[0].card), s.trump); // the pitcher's first lead named trump
    assert.equal(s.tricks[0].plays[0].seat, s.pitcher);
    const r = s.result;
    const given = 2 + (r.jack !== null ? 1 : 0) + (r.gameWinner !== null ? 1 : 0);
    assert.equal(r.points.reduce((a, b) => a + b, 0), given);
    assert.equal(r.gameTotals.reduce((a, b) => a + b, 0), s.dealt.flat().reduce((n, c) => n + gamePoints(c), 0));
    assert.equal(r.made, r.points[s.pitcher] >= s.bid);
    assert.ok(s.bid >= 2 && s.bid <= 4);
  }
});

test("replay: the seed plus the human's actions rebuild the same hand", () => {
  for (const seed of ["seed-3", "seed-17", "seed-60"]) {
    const { s, actions } = playOut(seed);
    assert.deepEqual(replay(seed, actions), s);
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

test("the daily seed is HMAC-SHA256(secret, 'daily:' + day), and its hash is SHA-256 of the seed", async () => {
  const seed = await dailySeed("s3cret", "2026-10-22");
  assert.equal(seed, createHmac("sha256", "s3cret").update("daily:2026-10-22").digest("hex"));
  assert.notEqual(seed, await dailySeed("s3cret", "2026-10-23"));
  assert.notEqual(seed, await dailySeed("other", "2026-10-22"));
  assert.equal(await seedHash(seed), createHash("sha256").update(seed).digest("hex"));
  await assert.rejects(() => dailySeed("", "2026-10-22"));
  await assert.rejects(() => dailySeed("s3cret", "22-10-2026"));
});
