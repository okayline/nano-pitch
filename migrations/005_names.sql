-- Usernames: every player can have a random two-word gen-z name (like aura-farm's), unique ignoring case, rerolled but never typed.
ALTER TABLE pitch_players ADD COLUMN name TEXT;
ALTER TABLE pitch_players ADD COLUMN name_key TEXT;
ALTER TABLE pitch_players ADD COLUMN pfp TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pitch_players_name ON pitch_players (name_key);

-- Game numbers: every game (daily or practice) gets the next number from one counter, pitch_meta 'games', when it begins.
ALTER TABLE pitch_hands ADD COLUMN game_no INTEGER;
ALTER TABLE pitch_practice ADD COLUMN game_no INTEGER;
