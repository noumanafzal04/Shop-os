# Reads are not writes — the `*.manage` bug class

**2026-08-08. Shipped.** Backend 1356 green / 5712 assertions; panel 122 green.

## What happened

A shop owner created a Cashier from the preset, signed in at the till, and the
product grid was empty. The shop had 50 products. The owner's own login showed
all of them.

`GET /products` was gated on `products.manage` — the permission to **edit** the
catalog. The cashier preset does not grant it, so the API returned 403, the
panel rendered `data ?? []`, and an empty grid is indistinguishable from a shop
with no stock. **A permission bug arrived disguised as a data bug.**

## The class, not the instance

One `*.manage` permission was answering two different questions:

- *May you change this?* — genuinely one answer per thing.
- *May you look at this?* — usually several, because several jobs read the same
  list.

Every job that must look at something it may not change walked into it. A
five-agent sweep across all ten presets confirmed eight instances beyond the
reported one, in three hiding places:

1. **Route middleware** — products, categories, branches, suppliers, purchase
   orders, fuel tanks/pumps, registers, `/pos/sessions`, `coupons/validate`,
   `pharmacy/dispensing`.
2. **Controller-level `abort_unless`** — invisible to any route-map audit. Day
   close, bank deposits, and the three blind-close checks in `PosController`
   all asked for `SETTINGS_MANAGE` in a line directly below a docblock saying
   "manager-only". The Manager preset deliberately withholds `settings.manage`,
   so every one of those comments was describing behaviour the code did not
   have.
3. **Service-layer filtering** — `GlobalSearchService` decided whether to
   include a Products section by asking `hasPermission(PRODUCTS_MANAGE)`. The
   search box worked perfectly for a cashier and simply never found a product.

## The fix

**`EnsurePermission` now reads a comma-joined list as ANY-of**, matching the
shape `EnsureFeature` already had. `User::hasAnyPermission()` backs it.

**Named read-sets in `Permissions`** so a route says *why* several jobs share a
read, and widening one place widens everything that shares the reason:

| Set | Members | Reads |
|---|---|---|
| `READS_CATALOG` | products, sales, inventory, purchases, orders | products, categories, serials, branch-stock |
| `READS_BRANCHES` | + settings, expenses, reports | the branch list |
| `READS_SUPPLIERS` | suppliers, purchases, inventory | supplier directory |
| `READS_PURCHASE_ORDERS` | purchases, inventory | POs **and receiving** |
| `SUPERVISES_TILLS` | settings, reports | lanes, shift history, day close, blind-close figures |
| `READS_FORECOURT` | settings, purchases, products, inventory | tanks and pumps |

**Rule: reads get a set, writes keep a single permission.** Every write verb
still sits on exactly the permission it always did — verified by reading the
generated route map back after the change, and by boundary tests asserting a
cashier still cannot create, edit or delete a product, print a coupon, or bank
the takings.

### Two judgement calls worth keeping

- **`SUPERVISES_TILLS` is `settings.manage,reports.view`, not `settings.manage`.**
  `reports.view` is the honest marker for "you supervise rather than work a
  lane": a supervisor and a manager hold it, a cashier never does, and it does
  not carry the power to reconfigure the shop.
- **Receiving is stockroom work, raising is buying.** `POST
  /purchase-orders/{po}/receive` moved to `READS_PURCHASE_ORDERS`; store, place
  and cancel stayed on `purchases.manage`.

## What was deliberately NOT changed

Two candidates were refuted on inspection and left alone:

- **`POST /inventory/counts/{id}/apply`** stays owner-only. That is
  maker-checker separation — the person who counts the shelf must not sign
  their own write-off — and the panel already explains the absent button in
  words rather than hiding it silently.
- **`GET /purchase-orders` was never the silent bug**: the router guard and an
  explicit "No access" alert already covered it. It was widened anyway, but as
  a scope correction, not as a fix for this class.

## The panel half

A 403 must never render as an empty list again.

`deniedReason(error)` (`src/common/api/denied.ts`) distinguishes refusal from
emptiness; `<NoAccess>` says which, in words, and names the remedy ("ask the
shop owner"). Wired into the POS grid, the exchange product search and the
transfers branch picker — the three places the sweep proved were silent.

`screenPermissions.ts` now accepts `string | string[]` and reads as ANY-of, so
the panel's map can express the same rule the server does. It had been strictly
narrower than the API after the split, which would have hidden the Purchases
menu from the stock keeper the fix was for.

## The test that should have existed

`StaffPresetTest` asserted what each preset **grants**. That is not the same
question as whether the job can be **done**, and the gap is where this shipped
from. `tests/Feature/PresetCanDoItsJobTest.php` (26 tests) signs in as a real
staff user behind each preset and loads the screen their job lives on.

It is written against capability, not permission names — if a future fix moves
which permission carries a read, these pass untouched; if one takes the lazy
path and grants `products.manage` to a cashier, the boundary half fails loudly.

`CatalogTest::test_staff_without_products_permission_blocked` had asserted that
a staff member holding `sales.manage` got a 403 from `GET /products`. That
staff member is a cashier. **The test wrote the bug down and guarded it** — it
is now `test_staff_who_sell_may_read_the_catalog_but_never_change_it`.

## The third axis

Business type produces **no** server-side permission gate at all — it only
shapes which screens and item types appear (`shopNav.ts`, 50 tests;
`BusinessTypeVisibilityTest`). It therefore cannot produce this bug class, and
was verified rather than changed.
