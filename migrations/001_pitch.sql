-- Daily Pitch's tables. They live in the moba-beat D1 database, beside moba-beat's own tables, so every table, index
-- and trigger name starts with pitch_ (a test fails on any other name). Migrations in migrations/ build the same tables.

-- One SHA-256 hash chain (src/ledger.js): a 'day' entry per UTC day (its seed_hash commits to the day's deal) and a
-- 'hand' entry per player per day, their finished hand.
CREATE TABLE IF NOT EXISTS pitch_ledger (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,          -- day | hand
  day         TEXT NOT NULL,
  player_id   INTEGER,                -- hand entries only; never published as a name
  record      TEXT NOT NULL,          -- the sealed JSON record
  prev_hash   TEXT NOT NULL UNIQUE,   -- one entry per chain head: the chain can't fork
  hash        TEXT NOT NULL UNIQUE,   -- SHA-256(prev_hash + "|" + record)
  created_at  INTEGER NOT NULL        -- unix seconds
);
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_day ON pitch_ledger (day) WHERE kind = 'day';
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_hand ON pitch_ledger (day, player_id) WHERE kind = 'hand';

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

-- A player's hand for a day: the actions so far (rebuilt from the day's seed with replay), and once it's done, the score.
CREATE TABLE IF NOT EXISTS pitch_hands (
  player_id   INTEGER NOT NULL REFERENCES pitch_players(id),
  day         TEXT NOT NULL,
  actions     TEXT NOT NULL,          -- JSON list of the human's actions
  done        INTEGER NOT NULL DEFAULT 0,
  final       INTEGER,                -- your score for the day, -4 to +4, once done
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, day)
);

-- The field: one summary row per day, added to in the same batch as each sealed hand. Never counted from the hands.
CREATE TABLE IF NOT EXISTS pitch_days (
  day     TEXT PRIMARY KEY,
  hands   INTEGER NOT NULL DEFAULT 0,
  -- how many finished with each score, -4 to +4
  s_m4 INTEGER NOT NULL DEFAULT 0, s_m3 INTEGER NOT NULL DEFAULT 0, s_m2 INTEGER NOT NULL DEFAULT 0, s_m1 INTEGER NOT NULL DEFAULT 0,
  s_0  INTEGER NOT NULL DEFAULT 0,
  s_p1 INTEGER NOT NULL DEFAULT 0, s_p2 INTEGER NOT NULL DEFAULT 0, s_p3 INTEGER NOT NULL DEFAULT 0, s_p4 INTEGER NOT NULL DEFAULT 0,
  -- how many bid each (pass, 2, 3, 4; the dealer's forced 2 counts as 2)
  b_0 INTEGER NOT NULL DEFAULT 0, b_2 INTEGER NOT NULL DEFAULT 0, b_3 INTEGER NOT NULL DEFAULT 0, b_4 INTEGER NOT NULL DEFAULT 0,
  -- how many took each point, and how many pitched and made their bid
  p_high INTEGER NOT NULL DEFAULT 0, p_low INTEGER NOT NULL DEFAULT 0, p_jack INTEGER NOT NULL DEFAULT 0, p_game INTEGER NOT NULL DEFAULT 0,
  pitched INTEGER NOT NULL DEFAULT 0, made INTEGER NOT NULL DEFAULT 0
);
