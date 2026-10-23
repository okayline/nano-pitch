-- Run before the Worker that plays Daily games goes live: adds the Daily games' tables and their ledger index. Nothing is removed.
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_daily ON pitch_ledger (player_id, game_no) WHERE kind = 'daily';

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
