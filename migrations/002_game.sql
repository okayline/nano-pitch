-- A day is now a game to 11 points, not one hand. The ledger gets 'game' entries (the old 'hand' entries stay on the chain,
-- unchanged), the field counts games and places, and a hand a player had already finished today is carried on as hand 1 of
-- their game (the same deal, so their moves replay the same way).
DROP INDEX IF EXISTS pitch_ledger_one_hand;
CREATE UNIQUE INDEX IF NOT EXISTS pitch_ledger_one_game ON pitch_ledger (day, player_id) WHERE kind = 'game';

DROP TABLE IF EXISTS pitch_days;
CREATE TABLE pitch_days (
  day      TEXT PRIMARY KEY,
  games    INTEGER NOT NULL DEFAULT 0,
  hands    INTEGER NOT NULL DEFAULT 0,
  place_1  INTEGER NOT NULL DEFAULT 0, place_2 INTEGER NOT NULL DEFAULT 0, place_3 INTEGER NOT NULL DEFAULT 0, place_4 INTEGER NOT NULL DEFAULT 0
);

UPDATE pitch_hands SET done = 0, final = NULL WHERE done = 1;
