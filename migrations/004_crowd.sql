-- The table's memory of bids: running counts, and a snapshot per day for the bots to follow.

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
