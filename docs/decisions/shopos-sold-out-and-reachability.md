# Eighty-six, and the switch nobody could reach

**2026-08-17.** Two findings from clearing the pending list. They are unrelated
features and the same lesson.

## 1. A dish could never be out of stock

`InventoryService` carries this, deliberately:

> *"Recipe/BOM ingredient depletion passes `allow_negative`: a dish is made to
> order, so an under-recorded ingredient must never block the sale."*

That is the right call. Refusing to settle a dine-in tab for food already eaten
is worse than a negative stock figure.

But it also means **a dish can never BE out of stock**, so a sold-out fish went
on selling all evening, to every table that asked. The only workaround was
deactivating the product — a catalog edit that strips it from the storefront
too, records no reason and no time, and that nobody reverses for twenty dishes
at eleven at night.

`CreateSaleAction` already had the word in a comment — *"the product may have
been 86'd/deactivated since"* — so the concept was in somebody's head. Only the
mechanism was missing.

### The shape of the fix

**A timestamp, not a boolean.** The failure mode of this feature is not
switching it on, it is **forgetting to switch it off**: a dish 86'd on Tuesday
and still off on Friday is lost revenue nobody is looking for. `sold_out_at`
lets the screen say "off since Tuesday", which is the sentence that gets it
turned back on. Pressing it twice keeps the FIRST time, for the same reason.

**It does not clear itself overnight.** Tempting, since most 86s last one
service. But the two failures are not equal: an item that clears itself while
the kitchen still has none puts a customer in front of a dish that never
arrives; an item that stays off after the kitchen prepped it makes staff ask
why they cannot sell it. The second is visible, immediate and free.

**Refused on the server, not merely hidden in the catalog.** A till holds the
menu in memory from opening and an offline till certainly does, so hiding it
client-side stops nothing. `ITEM_SOLD_OUT`, beside the serving-window fence —
and exempt on the trusted path for the same reason that fence is: a dine-in
tab, an online order or a reservation is food the customer already committed
to. Refusing their money because the kitchen has since run out is not a
protection, it is a shop that cannot close a bill.

**Sent to the till, never filtered out.** A delta that omitted the dish is
indistinguishable from a tombstone, and would leave yesterday's copy on the
tablet still selling it.

**`products.manage`, not `sales.manage`.** A cashier ringing a queue must not
take a dish off the menu with a mis-tap.

**Not fenced to food.** A mart's samosas by the till track no stock either, and
"we're out of those today" is the same sentence.

## 2. Offline selling could not be granted by anyone

`offline_selling` has been in `PlanLimits` for as long as the offline work has:
owner `tenant`, default 0, kind `policy`. The server reads it, the till obeys
it, `offlineCheckout` refuses to sell without it, and `PosCatalogController`
ships it to the device.

**No screen in the admin console could set it.**

The limits modal lists five countable ceilings — products, storage, branches,
staff, lanes — and this is not a number you extend, so it fell between them.
The only way to grant offline selling to a shop was to hand-write an HTTP
request.

> **Seventh time this codebase has produced the same shape: everything built,
> nothing a person touches able to reach it.**

Now a card of its own on the tenant detail page, with the reason granting is a
decision rather than a default: a till that sells offline prices the basket
ITSELF, and until that engine has been proved against a shop's own packs,
promotions and tax groups, turning it on means trusting a second pricing
implementation with a real customer's money.

One wrinkle worth writing down: `extendLimits` refuses any value below 1 — sane
for a ceiling, where zero products means a broken shop. A policy flag has no
such floor, so **revoking sends `null`**, which falls back to the registry
default of 0.

## The answer to "how does a shop set up offline?"

**It doesn't.** Nothing on the shop side needs setting up, and that is correct:

| | When |
|---|---|
| The till registers itself | first time the POS opens |
| The catalog caches | same moment |
| Shadow pricing runs | every online sale, silently |
| The home-screen icon | the install prompt offers itself |

The only decision is the admin's grant, and it should be made after reading
Reports → Offline over the shop's own trading.

## Also in this pass

- **PWA icons.** All three manifest entries pointed at `favicon.png`, which is
  48×48, while declaring 192, 512 and 512-maskable. A browser READS the image,
  finds nothing at an installable size, and quietly rules the app not
  installable. So "how do we give the till a desktop icon" had **two** blockers
  and only HTTPS was famous. `maskable` is a separate drawing, never the same
  file relabelled — a launcher crops it to a circle and would take the badge's
  own corners off.
- **Install prompt.** Chromium hands over `beforeinstallprompt`; **Safari fires
  nothing at all**, so an iPad can only be installed by a person tapping Share
  → Add to Home Screen. A counter tablet is very often an iPad, so the device
  the shop most wants this on is the one no code can ask. It is also detected
  by `maxTouchPoints`, because **iPadOS reports itself as `MacIntel`** — a
  user-agent check misses precisely the device the feature is for.
- **CVE pass.** Panel 15 → 1; backend `composer audit` clean. Every advisory
  was checked against the built bundle rather than assumed — `@babel/runtime`,
  `postcss`, `yaml`, `ajv`, `brace-expansion`, `esbuild`: **zero hits in
  `dist/`**. The survivor is `picomatch`, pinned upstream under
  `typescript-eslint`; lint-time, no path to a shop.

  One thing worth knowing before running it: `npm audit fix` moved **vite
  6.1.0 → 6.4.3**, and a dev server that was ALREADY RUNNING died with
  `Cannot find module .../chunks/dep-*.js` — the process was holding
  references to files the upgrade had replaced underneath it. Not a broken
  install; a stale process. `pkill -f vite`, `rm -rf node_modules/.vite`,
  restart. Typecheck, 882 tests and the build are clean on the new version.

## Backlog corrections

Four entries were stale, and the detail files were right while the index line
was wrong:

- The Aug-09 sweep's **nine bugs were fixed on 2026-08-11**; the index said
  "NONE fixed" for days afterwards.
- **Kitchen station typos** were already handled — the panel offers the shop's
  own list and the backend case-folds with a documented fallback.
- **Coursing / seat numbers** and **receivables** are built.

Still open from that list: **near-expiry notification**, **recurring income**,
**reorder list → purchase order**.

> Check the file, never the index line. Better still, check the code.

Related: [shopos-qa-sweep-aug09](shopos-qa-sweep-aug09.md), [shopos-offline-plan](shopos-offline-plan.md), [security-pass](security-pass.md).
