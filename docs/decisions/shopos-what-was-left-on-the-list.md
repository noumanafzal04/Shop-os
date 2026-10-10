# What was left on the list

**2026-10-10 · four things written down as "known, not fixed", a fifth asked that day, and a sixth it uncovered**

Each was found while doing something else and noted rather than chased. With
the queue done, they were done.

## 1. "Paid" meant "not behind", and held the shops that had paid nothing

The tenant list sorts every shop into a payment bucket, mutually exclusive so
they can be counted. `paid` was "not behind on anything" — which is true of a
shop that has never been given a plan.

The row's own word was corrected during the console walk ("not priced yet").
That left the filter and the row disagreeing about the same shop: "Paid 40"
was forty shops of which the ones on no plan had paid nothing, and they are
the shops an admin most needs to act on.

**A fifth bucket, `no_plan`** — on no plan and behind on nothing. A shop on no
plan whose period ran out is still `grace` or `unpaid`: it owes for that
period whatever happened to its plan afterwards. The chip, the filter and the
count now say the same thing (`Tenant::paymentStatus`, `scopePaymentStatus`,
`PAYMENT_STATUSES`; panel `paymentChip`, the list's "No plan yet").

## 2. Renewing a plan gave no figure — and kept the last one

"Assign / renew plan" asked for an amount and said nothing of what was due.
The shop's bill — plan AND add-ons — is on another card of the same page, so
an admin either scrolled away to add it up or typed the plan's price and
under-recorded the month by its add-ons.

The dialog now says it under the box (`admin/renewalDue.ts`): "Rs 2,499 plan +
Rs 3,000 for 2 add-ons = Rs 5,499", with **Use Rs 5,499**. *Offered, never
typed in:* a blank amount is how a free assignment is recorded, and a figure
that arrived already filled would turn "I only meant to change the plan" into
a payment nobody took. Moving to a different plan offers that plan's price
and says the add-ons are worked out once the shop is on it.

And it starts clean. The amount and receipt number of the LAST payment were
still in their boxes when the dialog was opened again — one press from
recording the same payment twice under the same reference.

## 3. A date picked on the console was picked on the laptop's calendar

Platform figures are cut in UTC and read in Pakistan. From midnight to five
in the morning the laptop is already on a date the server has not reached, so
"Today" on Billing, the Audit log or a commission period asked for a day with
nothing in it yet. The dashboard was given the server's date when it gained
its period; these three kept asking the laptop.

`common/time/platformToday.ts`, passed to each date control; the commission
screen opens on the server's month. `admin/datesAreThePlatforms.test.ts` reads
every console page: a date control there is told what today is, and no page
works a range out from `new Date()`.

## 4. The header ran 24px past a 320px screen

Menu button, the full brand lock-up, the bell and the account button came to
344 pixels. Being the first thing on every page, it let every page be dragged
sideways by 24. Below 360px the NAME gives way and the mark stays
(`Wordmark nameClassName`); the link keeps its name for a screen reader.
`e2e/narrow-phone.spec.ts` — the suite's layout checks otherwise stop at 390.

No migration in any of the four.

## 5. Where an add-on price is charged (asked the same day)

The owner typed Rs 25,000 against Products on the add-on price list, saw no
plan's price move, and asked whether a plan's price is worked out from these.

It is not, and the screen had never said so:

- A plan's price is the figure typed on the plan. Nothing adds it up.
- A plan INCLUDES a list of modules, at no extra charge.
- An add-on price is the monthly price of a module a shop has PAST its plan.
- What a shop pays is its plan's price plus the add-ons that shop has.

The list offered the same price box for every module, with no way to tell a
price that bills fifteen shops from one that bills none. So each price now
says where it is charged. `ModulePackages::reach()` answers, per module: the
active plans that leave it out for at least one trade that usually takes it,
how many real shops on a plan have it as an add-on today (demos are not
counted — nobody bills them), and the first three of those by name.
`GET /admin/modules/reach`; `admin/addOnReach.ts` turns it into a sentence.

### The first answer was wrong, and the second check found it

The first version had two sentences, chosen on `plans` alone: an add-on on
these plans, or "in every plan — never an add-on, so a price here is charged
to nobody". It was built, tested, mutation-tested and photographed saying
that about Products. The owner was told the same in words: no impact,
because Products is in every plan.

Reading the endpoint back before pushing: `products: {plans: [], shops: 1}`.
One shop had Products as an add-on. A business that only keeps books (a QA
one, on Enterprise) had been given Products. Products is not usual for that
trade, so no plan includes it FOR that trade — it is past that business's
plan, and its bill carried `Products — Rs 25,000 a month`. The price the
screen called "charged to nobody" was being charged.

`plans` was reckoned over the trades a module is usual for. A shop can have a
module past its plan with every plan on offer including it, two ways: its
trade does not usually take it (a deliberate cross-trade grant — the journey
shops have dozens), or its plan has since been switched off. Neither figure
stands for the other. The browser test asserted the wrong sentence and
passed, on the database where it was false: it checked that the sentence was
there, not that it was true of the shops.

Three sentences now, and nobody is charged only when no plan leaves it out
AND no shop has it as an add-on:

- "An add-on on Basic, Standard · 15 shops have it as an add-on now."
- "In every plan on offer, and no shop has it as an add-on — a price here is
  charged to nobody."
- "In every plan on offer, yet QA Finance 1006-172224 has it as an add-on —
  its trade does not usually take it, or its plan is no longer offered. A
  price here goes on its bill unless it has one of its own."

Shops are named while all of them can be (three or fewer) and counted after.
A line is drawn amber only when a price is typed where it does something its
box does not suggest (`pricedOddly`): charged to nobody, or to a shop nobody
would look at. On a database of test shops given every module, colouring the
third sentence by itself had a third of the list shouting about empty boxes.

The browser test gives a mart a pump, reads the server's count go up by one,
prices it, and reads the mart's bill grow by exactly that — "goes on its
bill" is checked against a bill.

Not done, on purpose: the box of a module nobody is charged for is NOT
disabled or hidden. A plan edited tomorrow can leave that module out, and the
price typed today would then be the right one. And nothing auto-prices a plan
from its modules — a plan is a commercial decision, and three shops on Basic
must not see their price move because one module's add-on price did.

No migration.

## 6. A save from one screen undid a price set from another

Found by the same check, twenty minutes later. The price list on the dev
database read `{products: 25000}` at 14:59 and `{}` at 15:17. No test clears
it: every browser run was repeated with the list read before and after, each
mutation run too, and it survived all of them. Then a price no test sets —
Bank Card Offers, Rs 350 — appeared on the list. The owner was on that screen,
pricing things, while the tests ran.

Two things followed from that.

**What I did wrong.** Seeing the list empty, I took it for something a test
had done and put Products back at 25,000 through the API. The likelier
reading is that the owner had cleared it — they had just been told it did
nothing — and I undid that. It was left as it then stood (their next save
carried it) and they were told, plainly, to clear it again if that was what
they meant. A list that changes while I am working is somebody working, not
a fault to repair.

**What was wrong in the product.** The screen saved the list WHOLE: every box
it held, as it had loaded them, replacing what was stored. A screen open
since before somebody priced Delivery did not have Delivery in its boxes, so
its next save — of anything — took Delivery's price off, and off the bill of
every shop holding it as an add-on. Silently: both saves said "Add-on prices
saved". The browser tests did the same thing with more discipline: read the
list, price one module, and at the end write the list back as they had found
it — erasing whatever had been priced in between.

Now a save says what was typed and nothing else:

- `PUT /admin/modules/prices {changes: {delivery: 300, customers: null}}` —
  a number prices a module, null or nought takes its price off, a module not
  named is not touched. `ModulePackages::reprice()` reads the stored row
  under a lock (not the settings cache, which may be five minutes old and
  would hand the second save the first one's "before") and writes it back.
- `{prices: {...}}` — the whole list, replacing — is still accepted, because
  the backend is deployed before the panel and the screen already in
  people's browsers sends that. Neither or both is refused.
- `admin/priceChanges.ts` works out what was typed; Save is enabled only
  when that is something.
- The tests price one module and hand back that one.

`e2e/admin-plans.spec.ts` opens the list, prices a module from "another
screen" through the API, saves a different one from the page, and reads the
request the page sent: one key. Both prices are on the list afterwards.

Not done: the price list is still not in the audit trail (`PlatformSetting`
carries no audit trait), which is why "who emptied it, and when" could not
be read off anything. Worth doing; it is its own piece of work.

No migration.
