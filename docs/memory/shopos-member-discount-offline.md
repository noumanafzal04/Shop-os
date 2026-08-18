---
name: shopos-member-discount-offline
description: "2026-08-17: a customer group's members' discount was NOT applied and NOT refused offline — silent full-price charge. Now refused. 8th 'the data was there and nothing read it'."
metadata:
  type: project
---

`docs/decisions/shopos-member-discount-offline.md`.

**How it was found — the question is reusable:** the shadow run is the evidence
for granting offline selling, so *which pricing rules does the mirror actually
cover?* A rule that shipped AFTER the mirror makes the shadow run report
"agreement" on sales that never exercised it.

Coupons, loyalty and bank offers were properly **refused**. Customer-group
discounts were **neither applied nor refused** → a member of a 10%-off group
served offline was charged **full price on a printed receipt**, silently.

**Why it hid: HALF implemented is worse than none.** `priceCart` honours a
group's price LEVEL, so wholesale groups price correctly and groups look
handled — right up until the one carrying a `discount_percent`.

**The server literally said so:** it ships `customer_group_id` + groups with
`discount_percent` and comments *"the group is here only because pricing cannot
work without it."* Nothing read `STORE.CUSTOMER_GROUPS`.

**Fix = the answer the same file already gave the bank offer**, one field away:
refuse, name the percentage, say they keep it by waiting. **Only groups with a
percentage** — refusing every member would take wholesale customers off the
till for no reason, and a refusal nobody needed is how the feature gets a
reputation for not working. Phone matched on the last 10 digits (0300… vs
+92300…).

**Eighth instance of "the data was already there and nothing read it"**, and
the sharpest: it was shipped to the device *specifically for this*.

> **When a rule is mirrored, ask what it was given that it does not use.**

Related: [[shopos-offline-plan]], [[shopos-modules-jul31]], [[shopos-sold-out-and-reachability]].
