# A walkthrough for whoever tests this

**2026-09-03** · `/tenant/qa` and `/admin/qa` · `modules/qa`

## What was asked for

A QA test flow: somebody new to the product should be able to read it and come
out knowing **what this product is, what each part is for, where it lives,
whether a shop even needs it, and how to test it** — the till and all its
options, the drawer, shifts, banks, the ledger, products, categories, sales, and
the rest.

## Why it is not the Help Centre

The Help Centre already exists and is good, and it is the wrong tool for this
job in a way that matters:

- It is written for a **shopkeeper**, so it explains how to *use* a screen, not
  what would count as it being broken.
- It is **filtered** to what this shop has — a chemist never reads about
  dine-in, a cashier never reads about staff. That is exactly right for them and
  exactly wrong for a tester, because **the parts a shop switched off are the
  parts somebody has to check are properly off.**

So this is separate, unfiltered, and it names the module each thing needs rather
than hiding what the module is off.

## Why a walk and not a document

A tester handed a forty-page document reads two pages and then clicks around.
What gets a product tested is **one thing on screen at a time, in an order
somebody decided, with a way forward** — Next and Previous over a fixed path,
arrow keys included, a progress bar, and a rail to jump by section.

The path is the order a shop actually lives in: sign in, get a catalog, put
stock in it, sell it, count the drawer, close the day, read the reports.

## The shape of every step

The same questions, always, and in this order:

1. **What this is, and why it exists** — first, because a tester who does not
   know what a screen is FOR reports the rules as defects and misses the real
   ones underneath.
2. **Where it lives**, **which module it needs**, **which trades get it**, and
   **whether a shop can run without it**.
3. **Walk it** — numbered *do this → expect that*. An instruction with no
   expectation is not a check; it cannot fail.
4. **What a real failure looks like here** — separated on purpose, so a rule
   working correctly is never filed as a bug.

## What it opens with

Not a screen: the three axes.

> **MODULE** — what this shop was given · **TRADE** — what kind of business it
> is · **PERMISSION** — what this person may do.
>
> Before reporting anything missing, check all three. Most first-week bug
> reports are one of them doing its job.

Plus the two rules that decide the severity of half of everything else: prices
come from the server, and a closed day is never rewritten.

## Where it lives

`/admin/qa`, linked from the admin rail — and `/tenant/qa`, which is in no menu
at all. A tester is usually signed in as the shop they are testing, and sending
them to the admin console to read how would be friction nobody needs. A
shopkeeper has no use for a list of the parts their shop was not given, so it
stays out of their menu.

## The tick boxes

Each step can be marked *walked* or *found a problem*, kept in that browser
only. A tester's own place-marker — not a record anybody else reads, because a
QA pass that reported itself complete would be a claim, and this file does not
make claims on somebody else's behalf.

## It guards itself

`content.test.ts` checks the parts that can be checked against the product:
every screen it sends a tester to exists in the router, every module it names is
a real module, every step has something to do, every check says what to expect,
every step explains itself first, ids are unique, and **the module count it
states in prose matches the registry** — a number in prose is the first thing to
rot, and that guard is mutation-proven.

Six existing guards also had to be satisfied for a new screen: the shared route
list, the full-screen pinned-room rule, menu reachability, the permission map,
the help-article map, and the browser walk. Each was answered with a reason
rather than an exemption, and `chrome.spec` now opens the page in a real browser
— it is full-screen with a sticky header, a rail and a progress bar, which is
exactly the shape of layout that spec exists to catch.
