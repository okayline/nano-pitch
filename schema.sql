-- Daily Pitch's tables. They live in the moba-beat D1 database, beside moba-beat's own tables, so every table, index
-- and trigger name starts with pitch_ (a test fails on any other name). Migrations in migrations/ build the same tables.

-- One SHA-256 hash chain (src/ledger.js): a 'result' entry for each finished game (its number, who finished, the totals and a
-- hash of their moves), and a 'daily' entry for each finished Daily game (the same, with the Daily game's number and its UTC day). Entries from before v0.9 stay on the chain: 'day' (a UTC day's deal), 'game' and 'practice' (a finished
-- game with its moves), and 'hand' (a single hand, from before games).
CREATE TABLE IF NOT EXISTS pitch_ledger (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,          -- result | daily | day | game | practice | hand (the last four only from before v0.9)
  day         TEXT NOT NULL,          -- the UTC day it was sealed
  player_id   INTEGER,                -- game, result and daily entries only; the page shows the player's current random name beside it (pitch_players.name), never a typed one
  record      TEXT NOT NULL,          -- the sealed JSON record
  prev_hash   TEXT NOT NULL UNIQUE,   -- one entry per chain head: the chain can't fork
  hash        TEXT NOT NULL UNIQUE,   -- SHA-256(prev_hash + "|" + record)
  created_at  INTEGER NOT NULL,       -- unix seconds
  game_no     INTEGER                 -- result and daily entries only: the game's number (a Daily game's, for daily) (not part of the hash; it is also in the record)
);
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_day ON pitch_ledger (day) WHERE kind = 'day';
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_game ON pitch_ledger (day, player_id) WHERE kind = 'game';
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_result ON pitch_ledger (player_id, game_no) WHERE kind = 'result';
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_daily ON pitch_ledger (player_id, game_no) WHERE kind = 'daily';

-- The server's own settings. key 'secret': the random secret the deals are made from (made on first use).
CREATE TABLE IF NOT EXISTS pitch_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Players: a random token in an `np` cookie; only its SHA-256 is kept. Devices loaded later each have a session.
CREATE TABLE IF NOT EXISTS pitch_players (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  name        TEXT,                   -- a random two-word name, given when the account is first looked at; rerolled, never typed
  name_key    TEXT,                   -- lowercase name, so names are unique ignoring case (index pitch_players_name)
  pfp         TEXT                    -- the player's profile pic (an emoji from PFP_POOL), their choice; none: the default
);
CREATE UNIQUE INDEX IF NOT EXISTS pitch_players_name ON pitch_players (name_key);
CREATE TABLE IF NOT EXISTS pitch_sessions (
  token_hash  TEXT PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES pitch_players(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pitch_sessions_player ON pitch_sessions (player_id);
CREATE TABLE IF NOT EXISTS pitch_rate_limits (
  key           TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- A player's game: every action so far across all its hands (rebuilt from the game's deal with replayGame), and once the game is
-- over, the human's final total. Games are numbered 1, 2, 3...; a player plays them in order, one at a time.
CREATE TABLE IF NOT EXISTS pitch_games (
  player_id   INTEGER NOT NULL REFERENCES pitch_players(id),
  n           INTEGER NOT NULL,       -- the game's number: it fixes the deal (pitch_deals)
  actions     TEXT NOT NULL,          -- JSON list of the human's actions
  done        INTEGER NOT NULL DEFAULT 0,
  final       INTEGER,                -- your total points when the game ended, once done
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, n)
);

-- A game's deal and its field. The seed is made from the server's secret and the number (engine/daily.js gameSeed), so it is not
-- stored; `memory` is the snapshot of the table's memory of bids taken when game n was first asked for (JSON), which the bots
-- follow for everyone who plays it, so a game's bots never change. The field is one summary row per game, added to in the same
-- batch as each sealed game, never counted from the games.
CREATE TABLE IF NOT EXISTS pitch_deals (
  n           INTEGER PRIMARY KEY,
  memory      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  games       INTEGER NOT NULL DEFAULT 0,
  hands       INTEGER NOT NULL DEFAULT 0,   -- hands played across all those games
  -- how many finished in each place (1 = the human won; a tie shares the better place)
  place_1  INTEGER NOT NULL DEFAULT 0, place_2 INTEGER NOT NULL DEFAULT 0, place_3 INTEGER NOT NULL DEFAULT 0, place_4 INTEGER NOT NULL DEFAULT 0
);

-- Daily games: one a UTC day for everyone (Daily game #1 is engine/daily.js DAILY_START, #2 the next day...). A player's Daily
-- games and each day's deal and field work exactly like pitch_games and pitch_deals; the seed is dailySeed of that day. The
-- first player of the day takes the bots' memory snapshot, so everyone that day faces the same bots.
CREATE TABLE IF NOT EXISTS pitch_daily_games (
  player_id   INTEGER NOT NULL REFERENCES pitch_players(id),
  n           INTEGER NOT NULL,       -- the Daily game's number
  actions     TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  final       INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, n)
);
CREATE TABLE IF NOT EXISTS pitch_daily_deals (
  n           INTEGER PRIMARY KEY,
  memory      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  games       INTEGER NOT NULL DEFAULT 0,
  hands       INTEGER NOT NULL DEFAULT 0,
  place_1  INTEGER NOT NULL DEFAULT 0, place_2 INTEGER NOT NULL DEFAULT 0, place_3 INTEGER NOT NULL DEFAULT 0, place_4 INTEGER NOT NULL DEFAULT 0
);

-- The table's memory of bids (see crowdKey in public/engine/pitch.js): how many players made each bid holding each type of hand,
-- added to when a game is sealed. A game's bots follow the copy taken in pitch_deals when it was first asked for.
CREATE TABLE IF NOT EXISTS pitch_crowd_counts (
  k    TEXT NOT NULL,                 -- hand type: "<points>-<cards in best suit>-<highest bid so far>"
  bid  INTEGER NOT NULL,              -- 0 (pass), 2, 3 or 4
  n    INTEGER NOT NULL,
  PRIMARY KEY (k, bid)
);
