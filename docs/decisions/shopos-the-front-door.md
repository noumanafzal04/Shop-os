# The front door: a landing page, a demo, and a way to keep it

**Date:** 2026-08-25
**Status:** shipped — `/` landing, `/demo`, `POST /api/v1/demo`, "Keep this shop", `/admin/shop-requests`

## What `cartze.shop` used to answer

The customer marketplace — a list of somebody else's shops. Two audiences were
sharing one address and only one of them pays for it. A customer reaches a shop
through *that shop's* own link; the shopkeeper arrives at the base URL deciding
whether to trust their day's takings to this.

So the storefront moved to `/shops` and `/` became the product's page.

Only the links that **meant** the marketplace were repointed. The 404, the
breadcrumb and the sign-in wordmark now reach the landing, which is what "home"
means for them. `homeForRole` was the one that would have gone quietly wrong:
it sent a customer to `/`, so signing in as one would have landed them on an
advert for a point-of-sale system.

## The demo: a shop of your own, not a shared sandbox

A shared demo is renamed to nonsense within a day, and two visitors ringing
sales at once make each other's figures meaningless — the thing being
demonstrated stops working *because* it is being demonstrated. So each visitor
gets their own tenant, seeded for their trade.

**No email at the door.** A shopkeeper will not fill in a sign-up to *look* at a
till, and the ones who would type an address before seeing anything mostly type
a false one. It is asked on the way out instead, by which time it is worth
something to both sides.

**24 hours, absolute from creation.** Two hours loses the shopkeeper who looks
at eleven between customers and wants to show their brother in the evening; a
week keeps abandoned shops for nothing. Sliding expiry was rejected for a
specific reason: it cannot be printed truthfully. An absolute one lets the
banner say *"clears itself away at Wed 6:19 PM"*, which is a sentence somebody
can plan around; a tab left open would keep a sliding shop alive for ever.

### This is not the demo seeder

`DemoDataSeeder` and `migrate:fresh` stay forbidden on production and nothing
here calls them. That rule exists because those two rewrite the whole install.
This creates **one** tenant and touches nothing outside it. A scoped creation
and a wholesale reseed are different operations that happen to share a word —
and the distinction was put to the person who set the rule rather than
reinterpreted quietly.

### Three fences, because these are real rows written by strangers

- **`is_demo` is checked inside `marketplaceVisible()`** — the one scope every
  marketplace read goes through — so no customer can order dinner from a shop
  that will not exist tomorrow. Written at five call sites it would have been a
  rule with four chances to be missed.
- **The shelf is stocked through `InventoryService`**, not by writing
  `stock_quantity`. That column is a rollup; the till sells from `branch_stock`,
  and a demo whose every item reads "out of stock" demonstrates the opposite of
  the thing it exists for.
- **The owner's password is random and never sent anywhere.** A demo is entered
  by the token the endpoint returns and by no other door.

## Keep this shop

The visitor has put their own products in and probably rung a sale. So this
**converts** what they built; handing them an empty new shop at the moment they
asked to stay would be the worst possible reply.

**While it is pending the shop keeps working.** Pressing this is the strongest
buying signal the product gets, and switching the shop off then is backwards —
there is nothing to protect either, since they are using a demo they already
had. `PruneDemoShops` will not touch a tenant with a request outstanding.

> The bound is on the **admin answering**, never on a timer that deletes a
> waiting customer's work.

Which costs the admin list its only discipline, so it is ordered by who has
waited longest and prints that at the top; three days turns it red.

**They set their own email and password at request time.** Until then a demo
owner could not sign in *at all* — throwaway address, random password nobody was
told — so closing the tab lost them the shop before its own clock ran out. Now
they can come back tonight whatever is decided, and approval sends nobody a
password through anything.

**Approval puts them through setup.** `setup_completed` returns to false so the
owner names their own business, picks their city and drops their own pin. No
real business is called "Retail Store Demo J3SJ". It is also why the request
form does not ask for a business name: **two forms asking one question is how
the two answers start disagreeing.**

**Declining needs a reason** and leaves the shop alone, on its original clock.

## Design decisions on the page itself

**Animation is an enhancement, not load-bearing.** Written the other way round
first — everything `opacity: 0`, rescued by an observer — and a screenshot
showed the whole page below the hero as blank. That was a capture artefact and
it was also the truth about the failure mode. The hiding is now applied only
once the hook has mounted and found a working `IntersectionObserver`.

Everything is switched **off** under `prefers-reduced-motion`, not slowed.
Somebody who asked their phone to stop animating things had a reason, and "we
made it faster" does not answer it.

**The demo button pulses rather than blinks.** The ask was for a blink and the
intent was right — draw the eye. Content that switches on and off is both an
accessibility failure and the visual language of a pop-up ad. A pulse reads as
"this one"; a blink reads as "close me".

**The hero draws the story rather than screenshotting a cart.** Rung offline, an
`OFF-` slip printed, then "line back — 3 sent". A screenshot at hero size is
unreadable, ages the moment a button moves, and needs a second one for dark
mode.

**The mark is `Brand.tsx`**, not the word typed again — that component exists
because the wordmark used to be three SVG files forever one edit apart.

## Found by running it, not by reading it

| | |
| --- | --- |
| `CreateDemoShopAction` read through whatever tenant was in context | its own owner lookup searched the wrong shop → **404 from a public endpoint** |
| `contact_phone` is optional; the code read it as always present | **500**. Every test sent one, which is why nothing said so |
| "Somebody has been waiting less than a **days**" | three fragments deciding one sentence; one function returns it now |
| the shared `Input` takes no `required` | the submit is gated on the fields instead — better anyway: a disabled button beside empty boxes says what is missing |

And a mutation caught **a test of mine passing against its own bug**: the
tenant-context fix's own test believed a bearer token puts a tenant in context.
The public route resolves none, so it proved nothing until it was rewritten to
set the context itself. Third time in one day.
