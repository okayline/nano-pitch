# Daily Pitch Changelog

Newest first. Times are Hawaii time (HST).

---

## v0.12
**Fri Oct 23, 2026**

- Hand history: on the Ledger page, each of your own finished games has a "Show hands" button. It opens the game round by round, the newest round first: the bids, then each trick, newest first (who played which card and who took it), then High, Low, Jack, Game and each seat's score for the round. Nobody else sees your hands, and a game's cards are never shown to anyone who hasn't finished it, because everyone who plays game N holds the same deal. A game that can't be rebuilt any more (the bots changed since it was played) says so. Added: the `GET /api/hands` answer and a `mine` mark on your entries in `GET /api/ledger`. Removed: nothing.

## v0.11.6
**Fri Oct 23, 2026**

- Your cards: a card no longer stays lifted after the mouse leaves it. The lift stays on a card while the table redraws (v0.11.2), but the mark that holds it was only taken off at the next redraw, so a card could stay up until something redrew the table. It is now taken off as soon as the mouse moves off the card or out of the page. Removed: the card staying up after the mouse has left.

## v0.11.5
**Fri Oct 23, 2026**

- Chat on the bots' turns: after each bot's bid or card, a viewer now says one of the friendly turn lines too ("you got this", "good luck", "take your time", "nice"...), not only on your turn. Never the same words twice in a row. Removed: nothing.

## v0.11.4
**Fri Oct 23, 2026**

- Sat-out seats: when the turn hops over a seat that sits out, only its name lights up; the other seats' cards no longer darken, so no cards look highlighted. Removed: the dimming of the other seats' cards during that hop.
- Chat while it's your turn: still runs the whole time, but the lines are friendly now ("you got this", "good luck", "take your time", "nice"...). Removed: "come on", "pass?", "go 4 coward", "bid bid bid", "tick tock", "waiting lol", "play it", "ur turn" and "no pressure".
- Chat after tricks and rounds: Removed: "rip", "ez", "L" and "told u". Kept: "💀" and "bruh".

## v0.11.3
**Fri Oct 23, 2026**

- Explanation text: taken off the result screen, the Account page and the ledger page. Removed: the line "The table hasn't seen enough rounds like these yet." on the result screen; the paragraph on the Account page about guests, "Logged in on N devices" and save codes (with its "No player here yet", "Guest" and "A save code or passkey brings your game to another device" sentences); and the paragraph at the top of the ledger page explaining the chain.

## v0.11.2
**Fri Oct 23, 2026**

- Your cards: a card under the mouse stays lifted when the table redraws. The table is rebuilt several times while the bots move and the chat talks, and each rebuild gave you fresh cards that started at rest, so the one you were pointing at dropped and lifted again. The page now remembers which card the mouse is on (like the lit bid) and draws it lifted from the start. Removed: the drop on every redraw.

## v0.11.1
**Fri Oct 23, 2026**

- Your cards: hovering one no longer makes it jump up and down. The lift moved the card off a pointer resting on its bottom edge, so it dropped, got hovered again and lifted again. Each playable card now has a 6px strip under it that lifts with it, so the pointer stays on it. Removed: the flicker.

## v0.11
**Fri Oct 23, 2026**

- Result screen: more room under the rounds grid so the scroll bar doesn't cover the bottom row, and a thinner scroll bar. Removed: the 4px gap that let it sit over the row.
- Round card: back to centred over the blurred table, with the Bid row and the one-line "This round" as before; the chat keeps going behind the card, blurred with the table. Removed: the card pinned to the bottom of the table, the chat drawn above the card, and the strip of four boxes for "This round".
- Your name: a visitor who has no save code or passkey is shown a random name from the start (the server rolls and signs it, nobody types one), and the page keeps it in the browser. It is sent to the server only when they make a save code or a passkey, and then it becomes their name. The page never says "You" for a new player. Removed: the "You" for new players, the server storing a name on a guest's first move or when their account is looked at, and the second copy of the name-fetching code.
- Chat: it never goes quiet. While it is your turn a viewer says something every few seconds (a few words about waiting, picked for the bidding or for the play) until you move, and the lines stay in the chat after you do; while a finished round's card is up the chat goes on too, instead of stopping after four lines. Removed: the silence on your turn and the four-line limit under the round card.
- Your turn: you can bid or play the moment your name lights up. Before, the table held its pause after the last bot move (about 0.8 seconds on the test table, up to 2.65 after a finished trick) with your name already lit and your cards not yet clickable. Removed: that wait before you can act.
- Result screen: the rounds grid shows whole rounds only. The emoji and total columns are narrower, so the gap before round 1 is small, and the grid's window is as wide as however many whole rounds fit, so no round is cut in half at the right edge when the grid is at the start or the end (it scrolls smoothly, with no snapping). Six rounds fit on a phone that is 390 px wide or more. Removed: the half-cut bubbles at the right edge and the extra space before round 1 that was added earlier today.
- Table: tiny drawn cards for the High trump, the trump Jack and the Low trump a seat holds so far this round, always in that order from the top (High and Low go to whoever played the highest and lowest trump, whoever wins the trick; the Jack goes to the winner of its trick, so it shows once that trick is won), and a number card: the Game card points in the tricks that seat has won (10 = 10, A = 4, K = 3, Q = 2, J = 1), shown once it is more than 0. They are drawn dark with a lavender edge and white text whatever the suit (the negative of an in-play card), a little dimmed. For North, West and East they stand in a column beside the hand (left of it, right of it for East), the Game points at the bottom, then the Low, the Jack and the High going up; yours sit under your name. Worked out in the page from the tricks it already has. Removed: nothing.
- Ledger: every hash (the entry's own, the moves, the seeds) is shown whole inside the entry, in normal weight, not bold, and the footer under it is "#6 · Oct 22nd, 2026, 22:39 HST" (Hawaii time, 24-hour). Removed: the 12-character shortened hash ending in "…", the hover text that held the full one, and the hash in the footer.

## v0.10
**Fri Oct 23, 2026**

- Daily game: once a UTC day, after the game you're in, you play that day's Daily game: the same cards and the same bots for everyone (Daily game #1 is today; the number goes up one each UTC day). It's counted on its own: "game #14, Daily game #2, game #15". It never interrupts a game in progress. Added: Daily games, their own field and results tally each day, a 'daily' entry on the ledger, and its row on the ledger page. Removed: nothing from numbered games.
- Fixed: when it came to your turn the arrow and "your bid" went blank for a moment and then came back. They now stay on you from the last bot's move. Removed: the blank moment.
- Table: the cards of a finished trick no longer dim; only the winner's glow stays. Removed: the dimming of the trick's other cards.
- Scoreboard: each score sits next to its emoji, with the name under them (it was under the name). Removed: the stacked emoji / name / score layout.
- Chat: more of it, and it reacts to the game. Six viewers who aren't at the table (made-up names, the same six all game) comment on tricks, on a bid of 4 and on how a round ended; the bidder says something when they make it or get set; bots' emoji and trick reactions come a bit more often. Removed: the three bots as the ones commenting on tricks.
- Chat: spade and club cards ("K♠") are blue. Removed: the plain white for them.
- Round card: the chat keeps going while it is up (the bidder and the viewers say a few more things, one at a time, above the card), and "This round" is a strip of four boxes, name over score, you outlined. Removed: the one-line "This round" row, and the Bid row (the line under the title already says it).
- Ledger: each finished game shows the player's name (their random one, as it is now; "Player N" if they have none), the four totals with the table's names best first, the game's field so far (players finished, % who beat the table, average rounds) and the Daily game's day. Removed: the old fixed table names (lagspike...) on those rows, and the bare "Player N" with only totals.
- Result screen: everyone but the winner goes black and white on the scoreboard, and the winner's name under the headline is bigger. Removed: the colour on the losers' cards, and the smaller name.
- Result screen: "Your score each round" is now a grid of all four seats, a row each with the total, one bubble a round; the bubbles keep their size and it scrolls sideways when the game is long. Removed: the row of only your scores. The left column is just each seat's emoji (no name), and the grid has no "Each round" or "Total" words over it.
- Result screen: the winner's name under the headline sits on its own line, then "got there first · you placed 2nd" under it (they ran together and wrapped). Removed: the name sharing a line with that text.
- Result screen: just two centred lines, the winner's name (big) and "got there first · you placed 2nd" (or "you won · first to 11 in 8 rounds"). Removed: the white glowing "... WINS" headline above them.
- Registry: each checkpoint now carries the finished game's public facts (kind, number, day, rounds, place, score, bids, trumps). Removed: the bare checkpoint with no facts.

---

## v0.9.6
**Thu Oct 22, 2026**

- Chat: a pass no longer reads "folds" (it is "passes", "nope" or "hmm...next"). Removed: "folds".
- Middle of the table: nothing shows when nobody has the turn. Removed: the 🤖 and the ✅ / 💥 over the round summary.

---

## v0.9.5
**Thu Oct 22, 2026**

- Middle of the table: an arrow points at whose move it is (down for you, left West, up North, right East); a sitting-out seat shows 💤, and a finished round shows ✅ made or 💥 set while its summary is up. Removed: the 🤖 in the middle.
- Turn highlight: when a hand is finished the turn goes straight to whoever leads next. Removed: the extra hop of the highlight to a sitting-out seat after the last card of a hand (it lit you, then West, then you again).
- Face-down cards: a dimmed seat's cards are darkened instead of made see-through. Removed: the half-transparent cards that showed each other's stripes through.

---

## v0.9.4
**Thu Oct 22, 2026**

- Chat: it sits in a fixed box with the newest line at the bottom, so a new line pushes the older ones up and nothing jumps; it carries on from round to round instead of starting empty; and it fades out towards the top (the first line almost gone, full strength by the fourth). Removed: the chat growing downward from the top and the jump it caused, and the chat clearing at each round.
- Sitting out: the turn lands on a seat that sits out and moves on in about a third of a second, its "Sat out" stays up for the rest of the round and is no longer dimmed with its cards. Removed: the two-beat pause on a sat-out seat, and "Sat out" showing only during one trick.
- Names: your name is on the scoreboard instead of "You", and a bot that was dealt your name gets another one. Removed: "You" on the scoreboard and two seats with the same name.

---

## v0.9.3
**Thu Oct 22, 2026**

- Round summary: it pops up over the table instead of replacing it, and the table stays on screen the whole time. The header reads "GAME 3, ROUND 8: SET!" (or "MADE IT!") with "Name bid 3 in ♠ and got SET!" on the line below. Removed: the full-screen summary, "ROUND 8 OVER" and the "Trump" chip.
- Sitting out: the turn goes to a seat that sits out, a beat later its "Sat out" lights up over its cards (still showing them), and then the turn moves on, including at the end of a round. Removed: "Sat out" showing from the first card on, and the turn skipping straight past that seat.
- Chat: the chatters react to tricks ("nr", "nt", "oof", emojis), each line arrives a moment after its move at a different moment each time, the lines fade out towards the top, there are seven of them, and the names are bolder. Your own cards are in it again ("You: K♦"). "nope" and "hmm...next" read as said ("Name: nope"). The bidder's line after the bidding says "bids 2" and is left out after "stuck 2". Removed: the stepped dimming of the top lines, "wins 2", and the line after "stuck 2".
- Table: the Pass 2 3 4 bar sits inside the table panel above your name, the highest bid's chip is always lit and never dimmed, your cards dim a little on your turn to bid, and the name and the status beside it stay on one line. Removed: the bar under the panel, the dimmed bid chip, and every line of explainer text under the game panel ("Your lead names trump", "Sealed on the ledger.", "The bots changed...").
- Smaller things: the version number sits right under the table.

---

## v0.9.2
**Thu Oct 22, 2026**

- Rules: a seat dealt no trump sits out the round: it plays no cards and its seat says "Sat out" (cards never played don't count towards Game). The Low point goes to the seat that played the lowest trump; Game points still go to whoever wins the trick. The bots count a lone 2 or 3 of trump as a Low point. Removed: Low going to whoever won the trick holding the lowest trump, and bots chasing a trick just because a low trump is in it. Games saved before this release replay under the new rules.
- Names: a "hand" (one deal) is now a "round" everywhere you read it ("Round 3", "ROUND 3 OVER", "Next round", the ledger), and the chat says "takes hand" for a trick. Removed: "hand" for a deal, and "takes trick".
- Subtitle: it shows the round whose result is on screen and moves on when the next round starts. Removed: the subtitle jumping ahead of the result.
- Chat: the text is bold again, actions read "Cracked Icon folds" with no colon, and card plays and emoji keep it ("Cracked Icon: K♦"). Removed: the colon on actions, the regular-weight chat text, and every "You:" line (your own moves are on the table).
- Table: names never wrap and match the other seat names, the face-down cards are twice as big, an empty row sits under the cards on the table and under your hand, and the hand row keeps its height when you have no cards. Removed: the "Play a card" hint.
- Final screen: the headline is the winner's name and "WINS". Removed: "YOU BEAT THE TABLE" and "THE TABLE WINS".
- Ledger and Account: the links read "Back  Account" and "Back  Ledger". Removed: the old link order.

---

## v0.9.1
**Thu Oct 22, 2026**

- The subtitle reads "Thu, Oct 22 · Game #N · Hand N" again, with today's date on your device. Removed: the v0.9 subtitle with no date.
- The chat dims towards the top again (the oldest line stays faintly readable, never gone). Removed: v0.9's chat with every line at full strength.

---

## v0.9 — "Any Game"
**Thu Oct 22, 2026**

- Games: every game is a number (1, 2, 3...) that fixes its deal, and everyone plays the same sequence in order, one at a time. The final screen has one Play button for the next game. The table's memory of bids is saved with each game when it is first asked for, so a game's bots never change. A finished game seals a result on the ledger: the game's number, the player, the hands, the totals and a hash of the moves (never the cards), so anyone can see the results without seeing a deal. Database: migration 006_games.sql (pitch_games, pitch_deals, the ledger's game_no) now, then 007_drop_days_and_practice.sql once this is live. Removed: the daily game, practice games and New game, "Today's game" and "Next deal in" (and the one-game-a-day gate), the day entries on the ledger and the seed reveal for new games (older entries stay), the date in the header, and the game you had unfinished under the old day-based deals (finished games stay on the ledger).
- The table: your cards sit inside the table panel under your name, your name replaces "You" on your seat with your status ("your bid") to its right; seat names and the face-down cards are much bigger; a negative score's bar is red.
- Chat: each message arrives on its own (an emoji, "takes trick" or "has the bid" no longer lands with the move before it), nothing fades, and the words vary: mostly just the card, sometimes "slaps down", "drops", "serves", "leads", "opens", "nope", "folds", "goes 3", "gets their 3", "W". Removed: the fade-out on older lines, the glow on names, and the plain "plays" on every move.
- Smaller things: the bid panel stays on the bid you last pointed at, the bid chip never lights up, Reroll name (the button sits above the line), a profile pic is a random roll when you tap it, and names are 12 characters or shorter. Removed: the Bidder chip, the big profile pic menu, and names longer than 12 characters.

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
