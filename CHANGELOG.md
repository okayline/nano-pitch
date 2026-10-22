# Daily Pitch Changelog

Newest first. Times are Hawaii time (HST).

---

## v0.3 — "First to 11"
**Wed Oct 21, 2026**

- A day is now one game to 11 points, not one hand. Hands are dealt one after another (everyone gets the same deals), the dealer moves one seat clockwise each hand, and the game ends when a seat has 11 or more and nobody else has as many; a tie at the top deals another hand. In 2000 bot-only games a game took 10 hands (median; most 6 to 13).
- After each hand, its result (HIGH, LOW, JACK, GAME, the bid, the hand's scores and the running totals) waits for ENTER. The table shows the hand number and everyone's totals.
- The end screen shows the final totals, your place, your score in each hand, and the field: how many finished on these deals, what share won, and how many hands a game took.
- Practice games: once today's game is sealed, P starts a game on random deals, as many as you like (30 an hour per address). Each finished one is sealed on the ledger as kind "practice" with its seed, so the table remembers it; practice games stay out of the field.
- The table's status line says BIDDER where it said PITCHER (the seat that won the bidding).
- Ledger: a finished daily game is sealed as kind "game" (actions, hands, totals, place). Old "hand" entries stay on the chain.
- Database (migrations/002_game.sql, 003_practice.sql): new pitch_practice table; pitch_days rebuilt to count games, hands and places; a hand already finished today carries on as hand 1 of that player's game.
- Removed: one hand a day and its score of -4 to +4; the field's score, bid and points-taken counts (pitch_days dropped and rebuilt); the ledger's one-hand-per-day index; the engine's single-hand `replay` (replaced by `replayGame`); the PITCHER label.

---

## v0.2 — "Even Table"
**Wed Oct 21, 2026**

- The three bots now all bid exactly what their hand is worth. Before, one seat bid a point over its count and one a point under: the bold one pitched about half the hands and scored worst (0.35 a hand against about 0.6), so it was easy to beat. In 6000 bot-only hands every seat now scores 0.64 to 0.68, a 3 bid is made about half the time and a 4 bid (about 1 hand in 100) about a quarter of the time. The dealer is stuck with the forced 2 more often (45%, was 35%).
- Removed: the per-seat bid offset (`BOT_OFFSET`), so the bots no longer differ in how risky they are.

---

## v0.1 — "First Deal"
**Wed Oct 21, 2026**

- One hand of 4-point cutthroat Pitch a day: the same six cards for everyone, against three bots that play by fixed rules. Bid once (pass, 2, 3 or 4; if nobody bids, the dealer is stuck with 2), then six tricks. High, Low, Jack and Game; the pitcher scores what they took if they made the bid, or loses the bid. Your day's score runs from -4 to +4.
- When your hand is done, the field shows how everyone did on the same deal: where your score stands, what people bid, and how many took each point.
- Every finished hand is sealed on the game's ledger. The day's deal is fixed before anyone plays (the ledger holds its fingerprint) and its seed is shown once the day is over, so anyone can check it. Today's hands stay hidden until then.
- Save codes and passkeys from the shared 88x31 accounts.
- Removed: nothing (first release).
