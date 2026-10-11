# Duplicate columns — an audit, before anything is moved

**2026-10-11 · asked for by the owner · NOTHING HERE HAS BEEN CHANGED**

*"jo duplicate hain unko bhi un ke tables main columns or fields ko le jate
ho" — "database ko achay way main le ke chalna, project slow work ni krna
chahye".*

Read off a scratch copy of the schema (every migration run into an empty
SQLite file — the development database was not touched): **119 tables, 1,804
columns, 373 indexes.** Each suspect was then traced to the code that writes
and reads it. A column appearing "twice" is one of five different things, and
only the first is a duplicate.

## A. Real duplicates — worth merging

| # | What | Evidence | Suggested | Risk |
|---|---|---|---|---|
| A1 | `products.type` **and** `products.item_type` | `type` is "legacy, ignored — derived from item_type" (`StoreProductRequest`), prohibited on update, written only as `$coarse` in `CreateProductAction`. Read by `isService()`, two `?type=` list filters, `OrderService` and `ReservationService` (`where('type', ItemType::Product)`). | Keep `item_type`; turn the five readers into a scope over it; drop `type`. | Low–medium: five call sites, one index. |
| A2 | `invoice_counters` **and** `document_counters` | Two tables that each hold "the next number for this tenant" — one for invoices (plus `training_next_number`), one keyed by `type` for quotations/advances/transfers. | One table (`document_counters` with types `invoice`, `invoice_training`). | Medium: invoice numbering is the most sensitive counter in the product. Do it only with the invoice-sequence tests green. |
| A3 | `note` (9 tables) vs `notes` (27 tables) | Same idea, two spellings: `cash_movements`, `commission_invoices`, `customer_ledger_entries`, `loyalty_entries`, `restaurant_ticket_items`, `rider_settlements`, `sale_document_payments`, `shop_requests`, `tenant_entitlements` say `note`. | Rename the nine to `notes`. | Low but wide: every API field of that name changes; the panel and phones read them. Cosmetic — last. |
| A4 | `gallery_images.caption` | No code reads or writes it. The only such column in the schema. | Drop it, or draw it. | None. |

## B. One column carrying two facts — rename, do not drop

| What | Evidence | Suggested |
|---|---|---|
| `tenants.online_shop_enabled` | Documented as "a denormalised copy of the Online Store module" and rewritten from `features.marketplace` on every module save (`Tenant::applyModules`). But the demo seeder sets it **false with the module on** (`--listed`) — it is also being used as "is this shop listed on the public marketplace", and the marketplace queries filter on it because it is indexed. | Decide which it is. If "listed": rename to `listed_in_marketplace` and stop `applyModules` overwriting it (today, saving an unlisted shop's modules lists it again). If only the copy: read `features` and drop it — at the cost of the index the marketplace uses. |

## C. A running total beside its ledger — keep

Reading a balance must not add up a ledger. These are written in one place
each, inside the same transaction as the entry that changes them.

| Total | Is the sum of | Written by |
|---|---|---|
| `products.stock_quantity`, `product_variants.stock_quantity` | `branch_stock.quantity` over every place | `InventoryService` (the rollup) |
| `customers.credit_balance` | `customer_ledger_entries` (`balance_after`) | `Customer::charge / settle` |
| `customers.loyalty_points` | `loyalty_entries` (`balance_after`) | the loyalty ledger |
| `purchase_orders.amount_paid`, `payment_status`, `received_total` | `supplier_payments`, received lines | the purchase actions |
| `cash_sessions.*` and `business_days.*` totals | sales and `cash_movements` of that shift / day | frozen at close |
| `sales.subtotal / discount / tax / total` | its lines | frozen when rung |

*Worth adding:* one "do the books agree?" check an admin can run on a live
shop — the load-test audit (`AuditLoadTestShops`) already compares khata with
its ledger; the stock rollup has no such check outside tests.

## D. Snapshots — keep

A sale keeps the name, price, cost, tax, unit and customer **as they were**.
Changing a product next month must not rewrite last month's invoice.
`sale_items.*`, `order_items.*`, `purchase_order_items.*`,
`stock_transfer_items.product_name`, `sales.customer_name / customer_phone /
promo_name / coupon_code`, `sale_documents.customer_*`,
`subscription_payments.plan_name`.

## E. Overrides — keep

A shop's own value over a platform or plan default: `tenants.limits` ↔
`plans.max_*` · `tenants.addon_prices` ↔ the platform's add-on prices ·
`tenants.commission_rate` ↔ the platform rate · `branch_prices.price` ↔
`products.price` · `products.tax_rate` ↔ its tax group.

## F. Two shapes of one thing — by design, worth knowing

- **A customer:** `customers` is a shop's own customer book (by phone);
  `users` with role *customer* is a marketplace account (addresses,
  favourites). They are not linked.
- **A rider:** `riders` is a shop's own rider; `rider_profiles` is the
  platform's rider account; `riders.rider_profile_id` joins them.

## G. Speed — link columns nothing indexes

Not duplicates, but asked for in the same breath. 21 `*_id` columns have
neither a foreign key nor an index. That number is not the finding: a column
only needs an index if something SEARCHES by it, so each was looked for in a
`where`. **Two are searched by today:**

| Column | Searched when | Index |
|---|---|---|
| `product_serials.sale_id` | a sale is cancelled or returned: which units go back on the shelf (`CancelSaleAction`) | `(tenant_id, sale_id)` |
| `expenses.recurring_expense_id` | Expenses filtered to one monthly template, or to "posted from a template / not" (`ExpenseController`) | `(tenant_id, recurring_expense_id)` |

The other nineteen are read WITH their row and never searched by
(`*.product_unit_id` and `*.variant_id` on line tables, `sales.promotion_id`,
`sales.customer_group_id`, `receipt_prints.branch_id / register_id /
device_id`, `product_serials.variant_id / branch_id / source_id`,
`sale_item_serials.product_id / variant_id / product_serial_id`,
`restaurant_ticket_items.product_id`, `restaurant_tickets.merged_into_id`,
`incomes.recurring_income_id`, `stock_disposals.stock_movement_id`). An index
on a column nothing searches by only slows down writes — leave them until a
screen asks.

The schema is otherwise well indexed: 373 indexes over 119 tables, and every
list a screen pages through has a `(tenant_id, …)` index under it.

## What I would do, in order

1. **G** — the two indexes. Additive, safe, and the only item here that
   makes anything faster.
2. **A4** — drop the unread column.
3. **A1** — one product type instead of two.
4. **B** — settle what `online_shop_enabled` means.
5. **A2, A3** — only if wanted; they are tidiness, with real blast radius.

Nothing in C, D, E or F should move.
