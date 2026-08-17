# The discount the till was given and never read

**2026-08-17.** Found by auditing the offline pricing mirror against the
features that shipped after it — not from a backlog.

## The question that found it

The two-week shadow run is the evidence for granting offline selling. That
evidence is only worth what the mirror covers: **if a pricing rule shipped
after the mirror was written, the shadow run reports "agreement" on sales that
never exercised it.** So: which pricing rules does `priceCart` know about?

Most were accounted for. Coupons, loyalty and bank offers are **refused**
offline — correctly, and each with its reasoning written down. Promotions were
mirrored after the first shadow run caught nine carts ten per cent high.

One was not.

## What was wrong

The server sends `customer_group_id` on every cached customer, and the groups
themselves with their `discount_percent`. Its own comment says why:

> *"The group is here only because **pricing cannot work without it**."*

The till stored both. **Nothing ever read them.**

`priceCart` says customer-group discounts are absent — deliberately, as part of
the offline allow-list. But `canSellOffline` never refused a member either. So
a customer in a 10%-off group, served during an outage, **was charged the full
price on a printed receipt, and nobody found out.**

## Why it hid

Because it is **half** implemented, which is worse than none.

A group's price *level* IS honoured — `priceCart` prices wholesale correctly.
So customer groups look handled, right up until the one that carries a
percentage.

## The fix is the one the same file already made

A bank offer is refused offline, with this reasoning, one field away:

> *a receipt wrong by the whole discount — which the customer discovers, days
> later, with no way to check.*

Identical case, identical answer. A member of a group carrying a percentage is
refused, told the percentage, and told they keep it by waiting.

**Only groups with a percentage.** Refusing every member would take wholesale
customers off the till during an outage for no reason, and a refusal nobody
needed is how the whole offline feature gets a reputation for not working.

Resolved locally from the till's own cached customers, matched on the last ten
digits of the phone — a shop types `0300…` and the record may hold `+92300…`,
and a customer at the counter is not going to be told their discount vanished
over a country code.

## The pattern, again

This is the **eighth** time: the data was already there and nothing read it.
Here it is sharper than usual, because the data was shipped to the device
*specifically for this purpose* and the comment saying so was sitting in the
controller the whole time.

> When a rule is mirrored, ask what it was given that it does not use.

## Guard

4 tests in `canSellOffline.test.ts`, mutation-checked: removing the refusal
fails 2 and only those. The percentage-free case and the walk-in are both
asserted to still sell, so the fix cannot over-refuse.

Related: [shopos-offline-plan](shopos-offline-plan.md), [shopos-modules-jul31](shopos-modules-jul31.md), [shopos-sold-out-and-reachability](shopos-sold-out-and-reachability.md).
