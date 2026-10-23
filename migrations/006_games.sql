-- Numbered games: a game is a number that fixes its deal, played in order by every player. Replaces games by day and practice games.
-- pitch_games: a player's game. pitch_deals: a game's table-memory snapshot and its field.
CREATE TABLE IF NOT EXISTS pitch_games (
  player_id   INTEGER NOT NULL REFERENCES pitch_players(id),
  n           INTEGER NOT NULL,
  actions     TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  final       INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, n)
);
CREATE TABLE IF NOT EXISTS pitch_deals (
  n           INTEGER PRIMARY KEY,
  memory      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  games       INTEGER NOT NULL DEFAULT 0,
  hands       INTEGER NOT NULL DEFAULT 0,
  place_1  INTEGER NOT NULL DEFAULT 0, place_2 INTEGER NOT NULL DEFAULT 0, place_3 INTEGER NOT NULL DEFAULT 0, place_4 INTEGER NOT NULL DEFAULT 0
);
-- A finished game's ledger entry (kind 'result') carries its number, and a player seals each game once.
ALTER TABLE pitch_ledger ADD COLUMN game_no INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_result ON pitch_ledger (player_id, game_no) WHERE kind = 'result';
