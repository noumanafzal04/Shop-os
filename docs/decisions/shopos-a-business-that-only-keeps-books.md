# A business that only keeps books is spoken to as one

**2026-10-10 · journey stage Q — the Finance Manager**

The last trade on the journey, and the odd one out. Every other type sells
something; a Finance Manager — an office, an agency, a school, a clinic keeping
only its books here — bought the Expense & Income module and nothing else. No
shelf, no till, no customer at a counter.

Nothing about it was broken. Every endpoint answered 200, three thousand
backend tests were green, and `BooksOnlyTenantWalkthroughTest` had walked its
API end to end. What was wrong could only be seen by sitting in it: **the
screens it bought went on talking to it as a shop with a till.**

## What an office read, on the product it paid for

| Where | What it said |
|---|---|
| Every cash entry | "Saved — recorded as cash, but **you have no shift open — the drawer was not adjusted**", with the form held open until dismissed. Every time, for ever. |
| Paid by / Received by | "Cash **(from till)**", "Cash **(to till)**" |
| Income | "Money in **that isn't a sale**… your sales revenue is counted automatically" — on the screen where it types every rupee it earns |
| Income categories | Interest, Owner Investment, Rent Received, Supplier Refund, Other Income. Nothing for a fee or a client's payment. |
| Cashbook | Seven columns, **Sales** and **Refunds** among them, empty for ever; "for physical cash at the counter, use the **POS shift close**" |
| Ledger | Chips for Sales, Refunds and Supplier paid — three buttons that can only answer "Nothing matches these filters" |
| Subscription | "Products 0 / 1,000", "Registers 0 / 1", "Offline selling 0 / 0"; "4.5% of the goods on each completed online order" |
| Settings | An **Online shop** card saying it could not have one; "shown on invoices and your storefront" |
| Dashboard | "Nothing needs you right now" — directly above "Attention needed · 1 to look at" |
| `/tenant/sales`, typed | The whole Sales screen, drawn around two requests the server refused |
| The admin's form | "Only what a **finance manager shop** can use" |

Each is small. Together they are a product telling a customer it was not made
for them, on every screen, every day.

## The rule

**Ask what the business HAS, never what trade it is called — and ask it once.**

Two questions decide every sentence above: *does it have a till* (the `pos`
module) and *does it sell* (`pos`, `marketplace` or `dine_in`). They are asked
of the modules, so a Finance Manager who is later given the till has a drawer
from that moment and a shop whose till was withdrawn has none.

- **Panel:** `common/tenant/kindOfBusiness.ts` — `sells`, `hasTill`,
  `buysFromSuppliers`, `sellsOnline`, and `noun` ("shop" or "business").
  Every screen's wording comes from a small tested module that takes it:
  `expenses/booksWords`, `income/cashbookShape`, `income/ledgerShape`,
  `shop/subscriptionRows`, `shop/settingsWords`. A page prints what comes back.
- **Server:** `BooksDrawer::hasTill()`; a business without one is handed no
  drawer sentence (`untouchedDrawerWarning` returns null).
  `PlanLimits::appliesTo()` and a `needs` list on each limit; `applies` on the
  commission answer.

It is the rule `reportTabs` already followed ("do not offer what the business
can never fill"), and the Setup screen already called it a business. Both had
been applied to one screen each.

## Three things that were not wording

**What it earns had nowhere to go.** `defaultIncomeCategories()` was
"deliberately type-independent": non-sales buckets, because sales revenue is
derived. That is true of every trade but this one, whose income is ALL typed by
hand. A type may now name its own (`income_categories` in its template);
finance does — Client Payments, Service Fees, Sales, Commission, Donations &
Grants, and the usual odd ones. A shop still gets no "Sales" bucket to
double-count in. Seeded at setup only: an existing finance business keeps the
list it has and can add the rest from the Categories tab.

**The only two things that can need it were not on its front page.** A
recurring bill never posts itself — a person confirms the figure — and a budget
never blocks. Both are deliberate, and both rely on somebody noticing. The
only places that said so were a badge on a tab of another screen and one
sentence at the moment of entry. So an office with its rent ten days overdue
opened to "Nothing needs you right now", which, having no stock to run low and
no order to accept, it would have been told every day for ever.

The dashboard now carries `books`: bills due, expected income due, categories
over their ceiling this month — as rows that land on the tab that deals with
them (`?tab=recurring`, `?tab=budgets`) and as the head-of-page sentence. Both
are derived from the same figures (`booksWaiting.ts`), which is also what ended
the head and the panel disagreeing. `BudgetStanding::forMonth()` is the one
answer the Budgets tab and the dashboard both read. A shop that keeps books is
told too, after its own trading alerts: its customer comes before its landlord.

**The ledger's filter bar did not do what it said.** "Clear all" cleared
nothing — the page merged what the bar handed back over what it already had.
And the ✕ on the period sent the server a custom period with no dates, which it
refuses. A ledger is always about a period (its balance is carried from the day
before the first one shown), so the dates are the page's subject, not a filter:
`periodIsGiven` — no chip, not counted, kept by Clear all. Elsewhere a date
range now counts as one filter, not two.

## Also

- **The Cashbook takes any window.** It had four buttons of its own; it has the
  Reports control now (`ReportWindow`, `useReportWindow`) — tax year, last
  month, a custom range — and "Open ledger" carries the window with it.
- **A usage row is a count; a rule is a sentence.** "Offline selling 0 / 0" was
  drawn as a bar for every shop. `kind: policy` rows are said in words
  (`offlineRules`), and not at all to a business without a till.
- **At the ceiling is not past it.** One branch on a one-branch plan was a red
  bar reading "Full" on day one. Amber, "All 1 in use"; red is for more than
  was allowed.
- **The map stays under the Save bar.** Leaflet stacks its layers at z-index
  200–1000 against the page; `isolate` on its container.
- **Recent activity uses the Activity page's words** (`activity/words.ts`). The
  dashboard card printed the audit trail's model names: "updated a tenant".
- **The module picker says what a trade is** (`admin/tradePhrase.ts`): "a
  books-only business", "an auto workshop" — not "a auto & tyre shop".
- `/tenant/sales` is behind the server's own ANY-of
  (`pos, marketplace, products, services`); `doorsTheServerShuts.test.ts`.
- Reports: no row of one tab; chart days as "1 Oct", amounts as "500,000".

## Not done, on purpose

- **The plan's own description** ("One shop, one counter…") is the admin's
  text. A books-only business on Basic reads a shop's sentence there until
  somebody writes a plan for it.
- **The trading day's 05:00 turn** still decides the date an entry opens on.
  Harmless for an office, and a rule nobody should fork for one trade.
- **No `h1` on the shop side's screens.** The console got one each on
  2026-10-10; the shop side is forty screens and its own piece of work.
- Existing finance businesses are not given the new income categories by a
  migration.

No migration.
