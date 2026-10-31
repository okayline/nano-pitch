# nano-pitch (Daily Pitch): working notes

## This repo

Daily Pitch: one hand of 4-point cutthroat Pitch per UTC day. You are seat 0 and three rule bots fill the other seats. The day's seed deals everyone the same cards, so the seed plus your actions rebuild the whole hand. Live at pitch.88x31.app (Worker `nano-pitch`). Treat a push to `main` as a release.

**Layout**
- `public/engine/pitch.js` is the rules and the bots in one file, loaded by the Worker, the page and the tests. Change a rule there, once. The bots follow fixed rules with no randomness.
- `engine/daily.js` makes the day's seed.
- `src/worker.js` is the Worker, `src/ledger.js` the hash chain, `src/names.js` the names.
- `public/` is the page: `index.html`, `app.js`, `chain.js`, `ledger.html` and `ledger.js` (the public ledger view), `style.css`, `version.js`.
- `migrations/` holds numbered changes (001 to 008) and `schema.sql` matches them.

**Data and services**
- Pitch's tables live in the shared `moba-beat` D1 database (binding `DB`), and every one is named `pitch_...`. Other games' tables live there too; don't touch them.
- Save codes and passkeys are the shared Accounts service, and checkpoints go to the shared copy registry. Both are the dungeon-items Worker (bindings `ACCOUNTS` and `REGISTRY`), so deploy dungeon-items first.
- A database change needs a migration file, `schema.sql` updated to match, and the live `moba-beat` database migrated before the push that needs it.

**Testing and releases**
- `npm test` runs `node --test test/*.test.mjs`.
- A release bumps `VERSION` in `public/version.js`, keeps `data-version` in `public/index.html` the same, and adds a `CHANGELOG.md` entry with the same number. `test/version.test.mjs` checks this.
- The detailed dev entry goes in `nano-pitch/changelog-v0.1.md` in the private dungeon-notes repo; `CHANGELOG.md` here stays short and in players' words.
