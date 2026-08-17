# The other side of the same page

**2026-08-17.** The last of the three Aug-09 gaps. The list is now closed.

## Only half of it existed

The expense manager's second pass gave rent, salaries and the internet bill a
template that falls due. **Income got the same table, the same categories, the
same drawer link, the same branch scope — and no template at all.**

A shop's recurring income is not exotic. The flat upstairs let to a tenant. The
shutter rented to the phone-repair man. A monthly supply contract with the
school down the road. A fixed commission. Every one of them arrives on the same
day each month and had to be typed from scratch every time — while the
electricity bill three fields away offered itself.

## The design is copied deliberately

Down to the column names. It is the same problem seen from the other side, and
**two screens doing one job in two vocabularies is how one of them ends up
half-maintained** — in a books module, where a shopkeeper reads both sides of
the same page.

## The rules worth restating

### A template falls DUE. It does not post itself.

No scheduler writes income. An entry that appears in the books because a clock
ticked is an entry **nobody checked against a payment** — and rent is exactly
the thing that goes unpaid quietly. The shop sees "2 due", confirms what
actually arrived, and posts.

### The amount is overridable at the moment of posting

This matters *more* on the income side than the expense side. Electricity never
bills twice the same, so an expense template that forces last month's figure
files a wrong one. But **a tenant who pays short has paid short** — and a
template that forces the agreed figure files a receipt for money nobody
received.

### The schedule advances from the DUE date, not from today

Rent collected four days late must not drag every future month four days later
with it. And a template left alone for three months **catches up one period at
a time**: each of those months genuinely had rent owing, and jumping to the
next future date would erase two of them.

### It files against the month it was owed for

Not today. A March rent posted in June belongs to March, or every report that
reads by date is wrong about both months.

### Posting early is refused

It would advance the schedule past a period that has not happened, quietly
skipping it.

## Tests

`RecurringIncomeTest`, 12 tests. Mutation-checked, and both mutations bite
hard: advancing from *today* instead of the due date fails 6; removing the
not-yet-due fence fails 11.

`test_nothing_posts_itself` runs `schedule:run` and asserts zero income rows —
the one assertion that would notice if somebody ever "helpfully" automated it.

The migration was rolled back and re-applied, per the rollback audit's standing
rule.

## Two collisions worth knowing

Test helper methods named `run()` and `post()` collide with PHPUnit's final
`TestCase::run()` and Laravel's `TestCase::post()`. Both fail as fatals, not
assertions. `sweep()` and `fileIt()`.

Related: [shopos-expense-manager-gaps](shopos-expense-manager-gaps.md), [shopos-qa-sweep-aug09](shopos-qa-sweep-aug09.md), [shopos-reorder-to-po](shopos-reorder-to-po.md).
