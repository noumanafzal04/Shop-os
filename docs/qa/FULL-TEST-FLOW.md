# Testing the whole product — the order to do it in

**Written 2026-08-29.** Every business type, admin side and shop side, every
module, every page.

The rule that shapes this file: **each layer answers a question the layer above
it structurally cannot ask.** Running them in the wrong order wastes hours —
a browser suite that fails on a type error took forty minutes to tell you
something `tsc` says in four seconds.

Bottom-up, cheapest first. **Stop at the first red layer and fix it** before
going down.

---

## Layer 0 — Gates · ~4 minutes

```bash
# backend
cd shopos-backend
./vendor/bin/pint --test <paths you changed>   # NEVER repo-wide — see below
./vendor/bin/phpunit                           # read the EXIT CODE, not the summary

# panel
cd ../shopos-admin-and-user-panel
npx tsc --noEmit -p tsconfig.app.json
npx eslint src
npx vitest run --pool=threads --poolOptions.threads.maxThreads=3
npm run build
```

**Catches:** types, lint, pure logic, every unit-level rule.
**Structurally blind to:** anything involving layout, real HTTP, or two modules
meeting. jsdom has no layout engine — `getBoundingClientRect()` returns zeros.

> **Two traps in this layer, both met while writing this file.**
>
> `php artisan test` has printed **"2225 passed" while exiting 1**. Check `$?`.
>
> And `pint` is deliberately NOT repo-wide. Run it over the paths you changed.
> Pointed at `app/ tests/` it reports **23 pre-existing files**, none of them
> yours — noise that trains you to ignore the gate. Worse, `pint … | tail`
> returns **`tail`'s** exit code, so the run reports **success while failing**.
> Redirect to a file, then read `$?`.

---

## Layer 1 — Scanners · ~1 minute

These do not test behaviour. They answer *structural* questions no test asks,
and each one exists because it already caught something real.

```bash
cd shopos-backend
python3 scripts/dead-endpoints.py       # dead route / call with no route / wrong verb
python3 scripts/dead-rules.py           # a rule enforced on ONE path of several
python3 scripts/one-rule-many-paths.py  # the same rule, drifted between copies
python3 scripts/silent-nulls.py         # a missing attribute is null and silent
```

Panel-side guards run inside vitest — `everyScreenIsWalked.guard.ts`,
`adminScreensAreReachable.guard.ts`, `reachable.test.ts`.

**Why this layer exists:** the recurring bug in this codebase is not a wrong
calculation. It is **built-but-unreachable** — a screen with no link, an
endpoint with no caller, a rule that guards the till and not the phone-order
door. Eight of those have shipped and been found later.

> **Every scanner needs a denominator.** "0 findings" is worthless without "out
> of N examined". Three guards once passed while blind to their own subject.

---

## Layer 2 — Backend feature tests · ~3 minutes

```bash
cd shopos-backend && ./vendor/bin/phpunit
```

Business logic per trade, in isolation. **~2,365 tests.**

**Structurally blind to:** whatever the panel actually sends. Every fixture here
was built by the same hands that built the feature, so both share the same
assumption. That is exactly how a forecourt shipped that **no station could
open a shift on** — past a 25-test suite named for that question, because every
fixture supplied the field the panel omits.

That blindness is the entire reason Layer 3 exists.

---

## Layer 3 — The QA sweep · ~30–60 min · **the main event**

```bash
cd shopos-backend && php artisan serve --port=8000    # leave running
cd docs/qa/sweep
python3 run.py          # all 21 phases
python3 run.py c g u    # or just the ones you touched
python3 mutate.py       # break it on purpose — every lie must be caught
```

Creates **a tenant per business type through the admin console**, logs in as
each owner, and drives the product over HTTP. Nothing stubbed, no fixtures.

### The 21 phases, and what each one is for

| | Phase | Asks |
|---|---|---|
| **Admin side** | **A** | The platform console before any shop exists — what it offers, enforces, must refuse |
| | **F** | The seams — where two modules meet (every phase before it passed alone) |
| | **T** | Who changed what — the audit trail on money, not just permissions |
| **Setup** | **B** | What each trade is *given*: catalog types, units, modules |
| **Selling** | **C** | Open drawer → shelf → ring → return → close. The hundred-times-a-day chain |
| | **N** | Where ringing and paying come APART — holds, quotes, exchanges, voids |
| | **O** | The two tickets that are not a sale |
| | **M** | Money given away on purpose — points, coupons, promotions |
| **Stock** | **D** | The shelf away from the till — receive, count, waste, transfer, adjust |
| | **S** | The shelf that ages — expiry is a **fence**, manufacture date is an **order** |
| | **U** | One product, three sizes |
| **Money** | **E** | Money that is not a sale — bills, khata, scrap |
| | **J** | Expense Manager ↔ the drawer |
| | **P** | The **day** — every lane, every float, banked and signed off once |
| **Structure** | **K** | More than one shop under one roof — per-branch stock |
| | **I** | Who is standing at the counter — **every phase before ran as OWNER**, who passes every gate |
| **Trade-specific** | **G** | What only one trade has — lot expiry, recipe, IMEI, tank |
| | **L** | The floor — table, kitchen, tab, settle |
| | **Q** | Paper, tanker, workshop |
| **Offline** | **H** | The till with no server |
| **Outside** | **R** | **The customer** — the only person the shop exists for, and the last to be driven |

**Order matters.** Phase I runs late on purpose: seven phases of green as the
owner are worth less than they look, because the owner passes every permission
gate there is.

**Found so far:** six real defects, nearly all one shape — *one question, two
paths, two different answers*.

### Two things that will waste your afternoon

**The token cache goes stale.** `docs/qa/sweep/.tokens.json` holds sign-ins from
the last run, and **an access token lives one hour**. A cache older than that
produces a mid-run expiry the sweep cannot always renew — on 2026-08-29 that
surfaced as `BUG A · at least one plan exists`, against a database holding four
active plans. **Delete `.tokens.json` and re-run** before believing any Phase A
failure.

**`throttle:auth` is 5/min per IP** and the sweep drives ~100 identities, so a
cold cache spends real minutes waiting. That is correct behaviour and the sweep
prints `… rate limited, waiting 62s`. Do not "fix" it. A slow run beats a wrong
one — and do not add your own `curl` sign-ins alongside a running sweep, they
come out of the same bucket.

**The harness now proves itself before it grades the product** —
`harness_test.py` runs as a preflight in `run.py` and the sweep refuses to start
if the reporter can turn a failed sign-in into a product bug.

---

## Layer 4 — Browser · ~20–40 min

```bash
cd shopos-admin-and-user-panel
caffeinate -i npx playwright test                    # all projects
caffeinate -i npx playwright test --project=phone    # one
```

**A shop reported seven defects by holding a tablet, and not one was caught by
3,079 green tests.** This is the only layer with a layout engine.

**Projects — the grid that matters:**

| Project | Signed in as | Why |
|---|---|---|
| `desktop` · `tablet-landscape` · `tablet-portrait` · `phone` | mart owner | Four widths on the core screens |
| `storefront` · `storefront-phone` | **nobody** | The signed-out shop front |
| `restaurant` · `restaurant-tablet` · `restaurant-phone` | food owner | A waiter holds a **phone**, not an iPad |
| `trade-{petroleum,pharmacy,automotive,retail,services,finance}` | each owner | A handful of page loads — the only thing that opens these at all |

`caffeinate -i` is not optional — **a closed lid killed a run and produced 18
"failures" that were one sleeping machine.**

---

## Layer 5 — A real device · manual

The last layer, and the only one that can see: a real service worker, a real
`navigator.onLine`, real IndexedDB, and **plain HTTP** (`crypto.randomUUID` is
`undefined` outside a secure context — jsdom is secure, so tests are blind).

1. Real phone, real shop, real wifi — turn it **off** mid-sale
2. Reload while offline · sell · come back · watch the badge drain to zero
3. Two shops on **one browser** — the catalog is scoped to the ORIGIN, not the tenant
4. Install the PWA, accept an update, confirm unsent sales survived it

> **Never "Clear site data"** on a till holding unsent sales. That is the money.

---

## The meta-layer: prove the test can fail

Applies to every layer above and is the only reason to believe a green run.

- **Delete a step and it must fail.** Never assert "not empty" on an envelope.
- `python3 mutate.py` for the sweep — **26 of 26 mutations caught** last run.
- A mutation that **passes** is either a missing check or a broken mutation.
  Once, a mutation of mine passed because its anchor matched three presets and
  it stripped the permission from the wrong one.

**A count of findings is not evidence without a count of attempts.**

---

## Per-trade checklist — what only this trade can break

Eight canonical types (`restaurant`→`food`, `grocery`→`mart`, `clinic`→
`pharmacy` etc. are aliases).

| Trade | Its own edge cases |
|---|---|
| **food** | Recipe cost, **per-size recipes**, dine-in tab ownership, KOT, split settle, 86/sold-out on 3 paths, kitchen board vs cancelled tab |
| **mart** | Scale barcodes, loose weight, packs (single/pack/box), per-branch stock, reorder → PO |
| **pharmacy** | Batch + expiry (**a medicine batch REQUIRES an expiry**), FEFO, Rx capture, schedule-controlled drugs on **both** doors |
| **retail** | Variants (size/colour), IMEI/serial capture, warranty, per-serial returns |
| **automotive** | Job card, vehicle history, **DOT tyre dating = age not expiry**, trade-in is a **tender** not a discount |
| **services** | Job board (laundry/tailor/repair/printing are sub-trades), **never booking** |
| **petroleum** | Tank dips, meter roll, test litres, rate change crossing a shift |
| **finance** | Books-only — **no till**; the sweep's `BOOKS_ONLY` path |

---

## Edge cases that cut across every trade

- **Money:** negative, zero, huge; rounding; inclusive vs exclusive tax; discount ceiling on **every** path
- **Time:** `toISOString().slice(0,10)` is **yesterday** before 05:00 in Karachi — use `toIsoDate()`. Tax year 1 Jul–30 Jun. Two open days.
- **Tenancy:** every list must be tenant-scoped. `getQuery()` **skips** global scopes; `toBase()` applies them. An expense total once summed every tenant.
- **Branch:** which branch is being operated ≠ Main. Adjustments once always hit Main.
- **Permissions:** a *write* permission gating a *read* is the `*.manage` bug class
- **Pagination:** can you reach **page two**? Nine screens once could not.
- **Layout:** no horizontal body scroll at 390px. An `sr-only` span in a `<th>` once pushed the page 84px sideways.
- **Offline:** what does the mirror **not** know? A refusal must be visible, never silent.

---

## The short version

```
0. gates          4 min    types, lint, units
1. scanners       1 min    reachability, drifted rules
2. backend tests  3 min    business logic per trade
3. QA sweep      45 min    ADMIN + SHOP, outside-in, 21 phases   ← the main event
4. browser       30 min    layout, 4 widths, 8 trades
5. real device   manual    service worker, offline, plain HTTP
   + mutate      always    prove each layer can fail
```

**A full pass is about 90 minutes of machine time.** Layers 0–2 run on every
change; 3–4 before a release; 5 when the offline or install path moved.
