# The ceiling follows the bill, not the screen

**2026-08-20** · `DiscountCeiling`, `AddTicketItemsAction`, `SettleTicketAction`,
`scripts/one-rule-many-paths.py`

## Two different questions, and only one of them travelled

`discounts.apply` answers **may you discount at all**. It was checked on the
counter, on a dine-in tab and at settlement alike — `StoreSaleRequest`,
`AddTicketItemsRequest` and `SettleTicketRequest` all ask it.

`max_discount_percent` and `max_discount_amount` answer **how much**. They were
consulted in exactly one place: `CreateSaleAction`.

So the **cashier** preset — which holds `discounts.apply` and deliberately does
*not* hold `discounts.override` — was capped at the till and **uncapped the
moment the same bill was a table.** A shop setting an owner had entered in
Settings → POS was simply absent from the Floor module.

And there was a second door. `SettleTicketAction` rings its sale with
`trusted_prices: true`, deliberately — the tab's captured snapshot *is* the
bill, and live menu state must not reprice food already eaten. The counter's
ceiling check sits on the untrusted branch, so it does not run there either. A
whole-tab discount keyed at settlement went through untouched.

## What changed

`DiscountCeiling::assert()` — one implementation, for the same reason
`ModifierResolver` is one: two copies of a rule do not stay one rule.
`CreateSaleAction` now delegates to it, and the tab and the settlement call it
too.

**Judged on the whole bill, not per line.** The counter has always summed every
line discount plus the cart discount against the whole subtotal, and a tab has
to be read the same way or the two disagree again. *Ten lines at ten percent
give away exactly what one line at a hundred does*, and a per-line check waves
the first one through. Voided lines are excluded — a line struck off gave
nothing away.

Still opt-in: both limits default to null. The control did not exist before it
was added, and defaulting to a cap would have stopped shops selling on the day
it shipped.

## How it was found

Not by reading the Floor module. By **listing what each selling path refuses and
reading the difference.**

Three places can start selling something — the counter, an order and a dine-in
tab. Each asks a list of questions first. Before today, five of those questions
were asked by all three; `DISCOUNT_LIMIT_EXCEEDED` appeared in one column and
nowhere else, next to eighteen others that legitimately belong to a counter
(khata, points, trade-ins, IMEIs). *The signal was in a column where most rows
are correct.*

That comparison is now `scripts/one-rule-many-paths.py`, beside `dead-rules.py`
from the same afternoon. Nine rules are asked by all three paths; every
difference carries a line saying why only one path asks it — a code with no line
is unexamined and the run exits non-zero.

**The useful moment for that tool is not the clean run.** It is the day somebody
adds a refusal to one path: the tool then asks, before the branch merges,
whether the other two need it.

## Two things the tool got wrong

**Settlement is not a peer.** Adding `SettleTicketAction` to the compared set
collapsed the intersection to zero — it does not decide whether something may be
sold, it takes money for food already eaten, and re-asking the item rules there
would refuse a bill the shop has already served. That is the tool losing its most
useful line, not finding anything. What settlement *does* share is the
giving-away question, so that is asserted by name — the guard must be **called**
by the counter, the tab and the settlement — rather than compared.

**A shared guard has to be credited to its callers.** Extracting the ceiling into
`DiscountCeiling` moved `DISCOUNT_LIMIT_EXCEEDED` out of all three path files, so
a naive per-file scan would have read the fix as *removing* the rule from
everywhere. `SHARED` maps each guard to its file, and `--prove` asserts both
shapes — a rule one path has and another does not, and a rule reached through a
guard — before the tool reports anything.
