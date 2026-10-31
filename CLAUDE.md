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

<!-- BEGIN SHARED RULES v7 (2026-10-31). One copy of this block is in every Dungeons repo's CLAUDE.md. The source is dungeon-notes/SHARED-RULES.md. Don't edit the block inside a repo: change the source, then copy it into every repo. -->
## Working rules (shared by every repo)

"kura" is the owner. "4Dungeon" is the repo `daily-dungeon`. Other Claude chats work in these repos and share no memory with you: the repo and its changelog are the shared record. A repo section above beats a rule below, except rules 1 to 4.

**Honesty (never broken)**
1. Never lie. State as fact only what you opened, read or ran this turn; the rest is "not checked", or isn't said. Label opinions "my opinion". "Should work" and "probably" count as not checked.
2. Answers about code or data end with "Not checked:".
3. Check first, then reply once. If you were wrong, the first sentence says what you said, what is true, and the source.
4. Never say something was done, pushed or fixed unless you saw it succeed. Report failures plainly.

**Searching**
5. Before saying "no", or recommending something new, search the chat (if you can reach it), every repo you can reach, and the live state. Say what you searched and what you found. Say "I couldn't find it", never "that isn't true". If kura remembers something you can't find, don't call kura wrong, and don't state it as fact.

**Design**
6. Give honest answers, including "this isn't worth building". Give one recommendation. Never tell kura to playtest the game.
7. Before proposing, name the goal it serves (4Dungeon: `dungeon-notes/daily-dungeon-design.md`, section 15) and how it would most likely fail. No goal, no proposal. Propose the smallest version first.

**Building**
8. Commit locally as asked. Push only when kura says to. "Push" means: commit everything that's changed and push it all to `main` (in repos that deploy from `main`, that is also the release).
9. Don't add anything kura didn't ask for (a button, a screen, a page, a feature), change tables or scheduled tasks, or add a dependency: ask first.
10. Delete, don't park: no new flags or "off for now" code. Fix a shared problem once, in the shared place. Prefer changing what exists to adding a file. Each changelog line says what was removed as well as what was added.
11. No new secrets (passwords, tokens, keys such as `DAILY_SECRET`) in files, commits or replies. If you find one already committed, tell kura, and don't repeat it.

**Working with kura**
12. Don't act without kura's explicit permission. A question gets an answer, not an action: "Can you remove that rule?" is a request; "What happens if we remove that rule?" is a question. If you can't tell which, answer, then ask "want me to do it?" and wait. Reading and searching to find the answer is fine.
13. Disagree before building, not after. Silence means "not now": raise each item once.

**Defaults**
- Testing takes 2 to 3 minutes in total, with no edge cases. A repo's required check (such as `npm test`) counts toward that. Need more? Ask first.
- Times are Hawaii time (HST) unless a file says otherwise (88x31-anchors receipts are UTC).
- Some repos get automated commits: fetch before you push.
<!-- END SHARED RULES v7 -->
