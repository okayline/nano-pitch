-- Practice games: extra games on random deals once today's game is sealed.
CREATE TABLE IF NOT EXISTS pitch_practice (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES pitch_players(id),
  day         TEXT NOT NULL,
  seed        TEXT NOT NULL,
  actions     TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pitch_practice_player ON pitch_practice (player_id, done);
