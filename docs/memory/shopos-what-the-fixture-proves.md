---
name: shopos-what-the-fixture-proves
description: REFERENCE — the load-test world is 9 shops and loadtest:audit asks 412 arithmetic questions; what each phase exists to exercise, and the 3 items waiting on a human decision
metadata:
  type: reference
---

Two commands, run against `shopos_test` (never the user's `shopos` without
asking):

```
php artisan loadtest:shops --fresh --products=200
php artisan loadtest:audit
```

**Nine shops**: grocery (3 branches), clothing, restaurant, pharmacy,
services, wholesale, filling station (2 sites), workshop, and an accountant
with no shop at all — the shape most likely to be broken by a change made
for everybody else.

**Phases, and what each one is FOR** — every one of these was added because
the audit reported a table empty and the natural reading was "feature not
built":

| Phase | Exercises |
|---|---|
| `theForecourt` | meters vs till vs dip; both variances seeded separately and never summed |
| `thePaperwork` | quotes, layaways, job cards across all three bay-board columns, warranty from a real serial |
| `theOnlineDoor` | counter-taken phone orders, riders, the COD settle |
| `theShoppers` | marketplace USERS — addresses, reviews, and the only channel commission is charged on |
| `theDiningRoom` | tabs in rounds, kitchen fired per round, split bills, tables left occupied |
| `theReward` | points SPENT, not just earned |
| `theStandingOrders` | recurring bills, some deliberately overdue |
| `theBanksOffer` | card offers, two live at once so `best()` must choose, one expired and kept |
| `theTills` | the device registry: in touch / a day out / past the window / revoked |
| `afterTheSale` | return, exchange and void — one fate per sale, assigned in one place |

**Three things are waiting on a human, not on work:** the two e2e volume
projects (the panel talks to `shopos`, and seeding it force-deletes tenants
there); the stray `JOB-000001` in `sahil-tyre-auto`; and whether a restaurant
table reservation falls under "no appointment booking".

The denominator is the point: 412 checks agreeing means something only
because `EMPTY: nothing` says the audit had every table to look at.

See [[shopos-model-a-and-the-blend]], [[shopos-sign-lives-in-the-type]],
[[shopos-admin-plan-model]], [[shopos-qa-sweep]].
