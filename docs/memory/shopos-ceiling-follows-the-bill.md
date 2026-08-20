---
name: shopos-ceiling-follows-the-bill
description: "FIXED 2026-08-20: max_discount_percent was consulted ONLY in CreateSaleAction, so a cashier capped at the till was uncapped on a dine-in tab and at settlement. One shared DiscountCeiling + scripts/one-rule-many-paths.py"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-20T08:25:59.216Z
---

**2026-08-20.** Two different questions, and only one of them had travelled.

- **`discounts.apply`** = *may you discount at all.* Checked on the counter, the
  dine-in tab AND the settlement (`StoreSaleRequest`, `AddTicketItemsRequest`,
  `SettleTicketRequest` all ask it).
- **`max_discount_percent` / `max_discount_amount`** = *how much.* Consulted in
  **exactly one place: `CreateSaleAction`.**

The **cashier** preset holds `discounts.apply` and deliberately withholds
`discounts.override`. So a cashier was capped at the till and **uncapped the
moment the same bill was a table.** The ceiling an owner set in Settings → POS
was simply absent from the Floor module.

**A second door:** `SettleTicketAction` rings its sale with
`trusted_prices: true` — deliberately, because the tab's captured snapshot IS
the bill and live menu state must not reprice food already eaten. The counter's
ceiling check sits on the UNTRUSTED branch, so it never ran there, and a
whole-tab discount keyed at settlement went through untouched.

**Fix: `App\Support\DiscountCeiling::assert()`** — one implementation, the same
argument that produced one `ModifierResolver`. Called by `CreateSaleAction`,
`AddTicketItemsAction` and `SettleTicketAction`.

**Judged on the WHOLE bill, never per line.** The counter has always summed every
line discount plus the cart discount against the whole subtotal, and a tab must
be read the same way or the two disagree again. *Ten lines at ten percent give
away exactly what one line at a hundred does.* Voided lines excluded (a line
struck off gave nothing away). Both limits still default to null — opt-in,
because the control did not exist before it was added.

## How it was found — reusable

**List what each selling path refuses, and read the difference.** Three places
can start selling something: `CreateSaleAction`, `OrderService::place`,
`AddTicketItemsAction`. `DISCOUNT_LIMIT_EXCEEDED` sat in one column and nowhere
else — **next to eighteen others that legitimately belong to a counter** (khata,
points, trade-ins, IMEIs). *The signal was in a column where most rows are
correct.*

Now `shopos-backend/scripts/one-rule-many-paths.py` (sibling of
[[shopos-sold-out-three-paths]]'s `dead-rules.py`). Nine rules are asked by all
three; every difference carries a line saying why, and an unexamined one exits
non-zero. **Its useful moment is not the clean run** — it is the day somebody
adds a refusal to one path and the tool asks whether the other two need it.

## The tool was wrong twice

1. **Settlement is not a peer.** Adding `SettleTicketAction` to the compared set
   collapsed the intersection to ZERO. It does not decide whether something may
   be sold; it takes money for food already eaten, and re-asking the item rules
   there would refuse a bill the shop already served. That is the tool losing its
   most useful line, not finding anything. What settlement DOES share is the
   giving-away question — asserted by name (the guard must be *called* by all
   three) rather than compared.
2. **A shared guard must be credited to its callers.** Extracting the ceiling
   moved `DISCOUNT_LIMIT_EXCEEDED` out of all three path files, so a per-file
   scan would have read the fix as **removing** the rule from everywhere.
   `SHARED` maps each guard to its file; `--prove` asserts both shapes.

Related: [[shopos-sold-out-three-paths]], [[shopos-no-roles]],
[[shopos-read-vs-manage]], [[shopos-table-ownership]], [[shopos-detector-vs-rule]]
