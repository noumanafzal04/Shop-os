---
name: shopos-develop-on-a-copy-stack
description: STANDING way of working since 2026-10-12 — while the user tests by hand or a browser suite runs, change code on a COPY stack (panel :5198 → backend :8001, same dev DB) and land the files afterwards; how it is built, what it is safe for, and its traps
metadata:
  type: feedback
---

**The user tests BY HAND on the dev servers (8000 / 5177) while I work**, and a
full browser regression takes ~2 h. Editing `panel/src` or served backend files
under either gives false failures (HMR mid-test) or breaks what the user is
pressing. So since 2026-10-12 new work is done on a copy and landed later.
MY choice of method — the user asked only that I keep working and not disturb
their testing ([[shopos-somebody-is-working]], [[shopos-suite-vs-itself]]).

**How to build it (scratchpad `dev/`):**
- Backend: `python3 scratchpad/mut/backend-copy.py <dir>` (own `vendor/composer`,
  `autoload.php`, `phpunit`, `bin` — a symlinked vendor runs the REAL tree's
  classes), then `php artisan serve --port=8001` from the copy. Same `.env`, so
  the same dev database; phpunit there is SQLite in memory and touches nothing.
- Panel: rsync the panel (not `node_modules`, `dist`, `.vite*`, `e2e/.auth`,
  `e2e/.journey`), symlink `node_modules` and `public`, add `cacheDir:
  ".vite-dev"` to its vite config (a shared `.vite` re-optimises the REAL
  server's deps), set `VITE_API_BASE_URL=http://localhost:8001/api/v1`, run
  `npx vite --port 5198 --strictPort`.
- Specs stay in the REAL `panel/e2e` and run from the real folder with
  `E2E_BASE_URL=http://localhost:5198 E2E_API_URL=http://localhost:8001/api/v1`.
  A saved sign-in belongs to its origin: one made on :5177 is not signed in on
  :5198 (rewrite `origins[].origin`, or make the session on the copy).
- Keep a list of every file changed on the copy (`dev/LAND.txt`) and copy them
  into the real tree only when NO browser suite is running; then run the whole
  gates on the real tree.

**Allowed beside a running Playwright suite:** one more single-worker Playwright
run on its OWN shop and owner (the 240/min limit is per person), single-file
`vitest run <path> --maxWorkers=2`, single-class `php artisan test --filter=`.
**Still not allowed:** the whole vitest suite, a build, the whole phpunit suite.

**Traps met:** `php artisan serve` is one thread — two suites on one backend
queue behind each other and change every timing; a shut lid cuts both
([[shopos-the-machine-slept]]: check `pmset -g log | grep -E "Sleep|Wake"` before
reading ANY failure — `net::ERR_NETWORK_IO_SUSPENDED` in a trace is the lid).

**Learned 2026-10-12 evening:**
- **A standing spec runs against the copy FROM THE COPY'S FOLDER**: `rsync -a
  --exclude='.*' panel/e2e/ dev/panel/e2e/`, then `cd dev/panel` and run with
  the two `E2E_*` vars. `setup` then signs in on :5198 and writes the copy's
  own `e2e/.auth` — the real one, which a running suite is using, is untouched.
  Mutations for a browser spec are done this way too (`dev/mutate-orders.sh`).
- **The user looks at :5177.** They said "local py 5177 py abhi show ni ho raha
  kuch b updated" when new UI sat on :5198. UI that is ready to be SEEN is
  landed and said to be there. Files only a lazy route imports (a page, its
  components) are safe to land while a suite runs on other screens; check who
  imports them first (`grep` for the module outside itself).
- **Work on the copy still loads the machine the suite runs on.** Pre-push run
  2026-10-12: 20 failures between 20:03 and 20:40 — 15 till specs whose sales
  rang OFFLINE, 3 serial-number specs, 1 admin, 1 timeout. KNOWN: the timeout
  sat inside a lid-shut sleep (20:34–20:40, `pmset -g log`); the server log
  (UTC) had no error for the others; all 20 passed alone afterwards. NOT
  proven: why the 19 failed — in those minutes I was running 331 phpunit tests,
  tsc and screenshot scripts on the copy. My inference, not a finding: treat a
  large phpunit filter or a build as "not beside a suite", copy or not.
