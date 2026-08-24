# A docket outlived its tab

**2026-08-24 · backend + e2e**

## How it was found

Not by looking for it. The e2e suite had no shop that could hold a dish — the
fixture is a mart, `itemTypesFor('mart')` is `["physical_product", "deal"]` — so
the floor, the tab and the kitchen board had **no browser coverage at all.** Not
a lower standard: none.

Giving the suite a restaurant meant building a fixture that puts a real ticket
on the pass, because a board with nothing on it passes every layout rule ever
written. And reading what was ALREADY on that board:

```
9 dockets on the pass
  KOT#1  fired  2026-08-18   ticket TAB-00002 is void
  KOT#1  fired  2026-08-18   ticket TAB-00003 is void
  KOT#1  fired  2026-08-24   ticket TAB-00148 is void
  … six more, five of them void
```

**Eight of the nine belonged to tabs that had been cancelled.** Two had been
fired six days earlier. A cook was being told to cook meals nobody was going to
eat or pay for, and nothing would ever take them down.

## Two readers, neither asking about the tab

`cancel()` voided the tab and voided its line items — and never touched the KOT
rows. `boardQuery` filtered on the docket's own status alone. So a docket for a
dead tab was indistinguishable from one for a table still waiting.

The dashboard was worse. It counted:

```php
->whereNull('served_at')
```

No docket status, no tab status, nothing. `kot_waiting` — the number an owner
reads to know what the kitchen owes — grew by one every time anybody cancelled
anything, and never came down.

Two readers of one fact, disagreeing with each other and with reality. So the
question is asked once now, `KitchenTicket::scopeForAnOpenTab`, and both read
it.

## Cancel writes. Settle does not.

These look like the same case and are not.

**Cancel is a known fact:** this food will not be cooked, eaten, or paid for.
The docket is void, so the row is written void. Anything already **served** is
left alone — cancelling a bill cannot un-cook food, and rewriting what the
kitchen actually sent out to tidy a screen is how a kitchen's own record stops
being true.

**Settle is not a fact about the kitchen at all.** A tab being paid says nothing
about whether anyone pressed Ready. Writing `served` on a docket the cook never
bumped would put a claim in the kitchen's record that the kitchen never made.
So settle writes nothing, and the BOARD makes the judgement: a closed tab is not
work.

## What the fixture cost to get right

Four attempts, and each failure was the fixture rather than the product:

| what happened | why |
|---|---|
| `TABLE_OCCUPIED` | it took `tables[0]`, and a tab was open on it |
| `fire` returned "nothing" | the response's `data` IS the kots array, not `{kots: […]}` |
| four tabs stranded on a real floor | cleanup ran after the assertions, so a failing run never reached it |
| `KOT #1` matched five cards | `kot_number` is a per-tab sequence; every card on a busy pass says #1 |

The third is [[shopos-fixtures-that-breed]] again, in a new shape: not a name
that grows, a **table that stays occupied**. Cleanup is registered the moment
the tab EXISTS now, not when the fixture finally succeeds, and it runs from
`afterEach`.

## And the check that made it findable

`e2e/skipReporter.ts`, written the same afternoon. Before it, the recipe spec's
"this shop cannot keep food dishes" was one line in a green run, and the
question "why can no food spec ever run?" was never asked.

> Checks that did not happen do not appear in a list of checks that did.
