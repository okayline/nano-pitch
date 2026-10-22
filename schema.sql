-- Daily Pitch's tables. They live in the moba-beat D1 database, beside moba-beat's own tables, so every table, index
-- and trigger name starts with pitch_ (a test fails on any other name). Migrations in migrations/ build the same tables.

-- One SHA-256 hash chain (src/ledger.js): a 'day' entry per UTC day (its seed_hash commits to the day's deal) and a
-- 'game' entry per player per day, their finished daily game, and a 'practice' entry for each finished practice game.
-- (Entries of kind 'hand', from before games, stay on the chain.)
CREATE TABLE IF NOT EXISTS pitch_ledger (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,          -- day | game | practice (older: hand)
  day         TEXT NOT NULL,
  player_id   INTEGER,                -- game entries only; never published as a name
  record      TEXT NOT NULL,          -- the sealed JSON record
  prev_hash   TEXT NOT NULL UNIQUE,   -- one entry per chain head: the chain can't fork
  hash        TEXT NOT NULL UNIQUE,   -- SHA-256(prev_hash + "|" + record)
  created_at  INTEGER NOT NULL        -- unix seconds
);
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_day ON pitch_ledger (day) WHERE kind = 'day';
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_game ON pitch_ledger (day, player_id) WHERE kind = 'game';

-- The server's own settings. key 'secret': the random secret the daily seed is made from (made on first use).
CREATE TABLE IF NOT EXISTS pitch_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Players: a random token in an `np` cookie; only its SHA-256 is kept. Devices loaded later each have a session.
CREATE TABLE IF NOT EXISTS pitch_players (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);
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

-- A player's game for a day: every action so far across all its hands (rebuilt from the day's seed with replayGame), and
-- once the game is over, the human's final total.
CREATE TABLE IF NOT EXISTS pitch_hands (
  player_id   INTEGER NOT NULL REFERENCES pitch_players(id),
  day         TEXT NOT NULL,
  actions     TEXT NOT NULL,          -- JSON list of the human's actions
  done        INTEGER NOT NULL DEFAULT 0,
  final       INTEGER,                -- your total points when the game ended, once done
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, day)
);

-- The field: one summary row per day, added to in the same batch as each sealed game. Never counted from the games.
CREATE TABLE IF NOT EXISTS pitch_days (
  day      TEXT PRIMARY KEY,
  games    INTEGER NOT NULL DEFAULT 0,
  hands    INTEGER NOT NULL DEFAULT 0,   -- hands played across all those games
  -- how many finished in each place (1 = the human won; a tie shares the better place)
  place_1  INTEGER NOT NULL DEFAULT 0, place_2 INTEGER NOT NULL DEFAULT 0, place_3 INTEGER NOT NULL DEFAULT 0, place_4 INTEGER NOT NULL DEFAULT 0
);

-- Practice games: after today's sealed game a player can start extra ones on random deals. One in progress at a time.
-- The seed is made when the game starts (not the day's seed); the finished game is sealed on the ledger with its seed.
CREATE TABLE IF NOT EXISTS pitch_practice (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES pitch_players(id),
  day         TEXT NOT NULL,
  seed        TEXT NOT NULL,
  actions     TEXT NOT NULL,          -- JSON list of the human's actions across all its hands
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pitch_practice_player ON pitch_practice (player_id, done);

-- The table's memory of bids (see crowdKey in public/engine/pitch.js). pitch_crowd_counts: how many players made each bid
-- holding each type of hand, added to when a game is sealed. pitch_crowd: the snapshot of those counts taken when a day begins
-- (JSON); the bots all day follow this copy, and the day's ledger entry commits to its hash, so a day's bots never change.
CREATE TABLE IF NOT EXISTS pitch_crowd_counts (
  k    TEXT NOT NULL,                 -- hand type: "<points>-<cards in best suit>-<highest bid so far>"
  bid  INTEGER NOT NULL,              -- 0 (pass), 2, 3 or 4
  n    INTEGER NOT NULL,
  PRIMARY KEY (k, bid)
);
CREATE TABLE IF NOT EXISTS pitch_crowd (
  day     TEXT PRIMARY KEY,
  memory  TEXT NOT NULL
);
