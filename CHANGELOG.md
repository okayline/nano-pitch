# Daily Pitch Changelog

Newest first. Times are Hawaii time (HST).

---

## v0.8 — "New Faces"
**Thu Oct 22, 2026**

- Nano Pitch: the game's name on the page is NANO PITCH now. All text is bold. The header reads "date · Game #N · Hand N" (the Game # is a counter shared by every game, given at its first move, and written into the game's sealed ledger record).
- The bots: each game seats three bots with random gen-z names (aura-farm's lists) and random profile pics. Each bot draws a personality or none: safe (bids a point under its count), bold (goes from 3 straight to 4) or follows the crowd (after 3 players, not 5), so a table can have two safe bots or no personality at all. They sometimes post just an emoji after a move. Removed: the fixed lagspike, mogger99 and tiltproof, the same three in the same seats every day.
- The rule: when you can't follow the suit led, any card is legal. Removed: being forced to play trump.
- Games any time: New game (in the header) starts a practice game whenever you like. Removed: "Finish today's game first."
- Players: a random name when you first open Account (new name any time) and a profile pic you pick by tapping it there. Account shows "name's account", whether you're logged in, and a Log out button; the Account and Ledger pages link to each other. Database: migration 005_names.sql (names, profile pics, game numbers). Removed: the small "Log out of this browser" link, and "Back to the game" on the Ledger page.
- The table: its height no longer jumps; the hand result opens inside the table's place under the scoreboard; each score has its bar below it, and a negative score's bar runs left out of its frame; the seat to move stays bright while the others dim; Pass is preselected and the other bids light up under the mouse; the bid chip reads "bid 2 in ♦"; chat shows the last 5 moves, one row each, with profile pics; a little less waiting after East plays and after a trick. Removed: the Tricks chip, the "Hand N / first to 11" line, the fire icon on the bid chip, the always-lit 4, and the "pass" labels left under every seat after bidding.

---

## v0.7.1
**Thu Oct 22, 2026**

- The move list moved into the table's top right corner, like chat on a stream: the newest 5 moves, with no panel behind them, older ones fading.
- Removed: the move list panel under your hand.

---

## v0.7 — "Slow Hand"
**Thu Oct 22, 2026**

- The table's moves play out one at a time: after your move, each bid and card shows on its own (1.3 seconds apart), and a finished trick stays on the table with the winning card lit (2.75 seconds) then the table clears before the next one starts or it is your lead. The last trick of a hand plays out before the hand's result, and the bids before yours play out at the start of each hand. Taps and keys wait until the moves have played.
- A move list under your hand: every bid, card and trick of the hand so far, newest at the bottom.
- The PASS and bid buttons sit under the table, above the bidder line. The bidder line shows the bidder, the bid and the trump suit together.
- Removed: the Trump chip on the table screen (the suit is on the bidder line now; the hand result screen still shows trump), and the jump straight from your move to the table after every bot had played.

---

## v0.6 — "Open Book"
**Wed Oct 21, 2026**

- A ledger page (Ledger, top of the game): every day's entry and every finished game, newest first. A day shows its seed hash and the table's memory hash, and its seed once the day is over; a game shows the player number, the hands, the totals and the place; today's games show as hidden until the day is over. "Check the chain" fetches every entry and checks every hash in the browser (public/chain.js); today's hidden entries are checked for their link, not rehashed.
- Hooked up to the shared registry: after every seal (a day, a daily game, a practice game), the ledger's entry count and newest hash go to the registry as a checkpoint, so the registry's Bitcoin stamp covers Pitch's ledger too. A registry that's away never stops a game; the next checkpoint covers it. New REGISTRY binding in wrangler.jsonc (dungeon-items' Registry entrypoint).
- The page's styles moved from index.html into public/style.css, shared with the ledger page.
- Removed: the inline `<style>` block in index.html.

---

## v0.5 — "Neon Table"
**Wed Oct 21, 2026**

- A new look, after aura-farm: near-black with purple glow, rounded panels, real card faces (red and black, big rank and suit) and one bright gradient button, laid out for a phone first. Taps and the old keys both work (1-6 for cards; P, 2, 3, 4 to bid; Enter for the next hand; P for a practice game).
- You play against the table: one robot 🤖 that plays the other three hands, lagspike (left, violet), mogger99 (top, pink) and tiltproof (right, cyan), gamer tags from TILT.EXE's name list, each with its own profile pic (🐌 lagspike, 🗿 mogger99, 🧊 tiltproof; you're 😎). A scoreboard shows your total and each of the table's hands, with a bar for how close the leader is to 11.
- A hand's result uses 👑 High, 🪶 Low, 🃏 Jack, 🎯 Game and 🔥 Bid; the end screen says YOU BEAT THE TABLE or THE TABLE WINS.
- Removed: the 80-column text screen and its VT323 font (public/fonts), and the seat names West, North and East.

---

## v0.4 — "The Table Remembers"
**Wed Oct 21, 2026**

- The bots now learn from the players. Every bid a player makes is filed under the type of hand it was made with (the points it expects in its best suit, how many cards that suit has, and the bid it faced). Once at least 5 players have held a type of hand, a bot holding that type bids what most of them bid (a tie goes to the lower bid); otherwise it bids by its own count, as before. Card play is unchanged.
- The learning shows up the next day: the table's memory is copied once when a day begins, and that copy is what the bots follow all day, so everyone faces the same bots and a saved game always replays the same way. The day's ledger entry commits to the copy's hash (`memory_hash`).
- Both daily and practice games add to the memory when they are sealed (a forced 2 as dealer doesn't count, since it wasn't a choice).
- Database (migrations/004_crowd.sql): `pitch_crowd_counts` (the running counts) and `pitch_crowd` (one snapshot per day).
- Removed: nothing.

---

## v0.3.1 — "Fresh Start"
**Wed Oct 21, 2026**

- Fixed: the page showed "Something broke" for a player whose saved moves were made before the bots changed in v0.2 (the old moves no longer line up with the retuned bots, so the game couldn't be rebuilt). An unfinished game whose moves no longer replay now starts over, with a line saying so; the same goes for an unfinished practice game.
- A sealed game that can't be rebuilt any more says so instead of breaking.
- Removed: nothing.

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
