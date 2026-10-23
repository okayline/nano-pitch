-- Run after the Worker that uses pitch_games is live: the old tables' games (by day, practice) are replaced by numbered games.
-- Finished games stay on the ledger. The running counts of bids (pitch_crowd_counts) stay.
DROP TABLE IF EXISTS pitch_hands;
DROP TABLE IF EXISTS pitch_practice;
DROP TABLE IF EXISTS pitch_days;
DROP TABLE IF EXISTS pitch_crowd;
