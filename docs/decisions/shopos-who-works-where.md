# Who works where

**2026-08-24 · backend + panel**

## The most expensive shape there is

`ResolveBranch` pins a staff member to `users.branch_id`. A header can never
move them, their reads are that one branch, and their sales draw down that
branch's stock. The whole staff-branch model runs on that column.

**The panel never once set it.** The word "branch" did not appear in
`TenantStaffPage`, in `StaffPage`, or in `useStaff`. So every staff member in
every multi-branch shop fell back to Main, and branch two's cashier rang on
branch one's shelf.

This is the worst version of built-but-unreachable, because **nothing looks
wrong**. The server was right the entire time. There is no error, no empty
state, no 403 — just a shop whose second branch quietly sells the first
branch's stock, and reports that reconcile perfectly against the wrong site.

The Help Centre had been saying "Staff are assigned to a branch and see that
branch's figures" the whole time: a promise stated in one file and implemented
nowhere, which is this codebase's most repeated defect and reads as DONE.

## And the other half: they could not be told

`BranchSwitcher` returned null for anyone who was not an owner, and nothing else
on any screen named the branch. A staff member could not be **wrong** about
where they were — the server pins them — but they could not **know**, and on a
two-branch shop the person counting a drawer has no way to check whose drawer it
is.

They get a read-only label now. Read-only on purpose: the pin is the owner's
decision, taken on the staff screen. **A switch the server ignores would be
worse than silence.**

## What was built

- `User.branch_id` in the panel's own type. The server had been sending it since
  branches existed; the type did not have the field, so it arrived and was
  dropped.
- `StaffInput.branch_id`, sent **tenant side only** — the platform route refuses
  it (`prohibited`), because a platform staff member belongs to no shop and so to
  no branch of one.
- A Branch select on the staff form and a Branch column on the list, both **only
  where there is more than one branch**. Same rule the other branch-scoped
  surfaces follow, so a single-site shop is never shown a column reading "Main"
  all the way down, or a question with one answer.
- `""` sends `null`, which the server reads as "no pin, falls back to Main". The
  list says "Main" rather than "—", because that is what the server does with it;
  "—" would suggest they work nowhere.

## The one that could do real damage

A staff member pinned to **another shop's** branch would read and write a
business that is not their employer's. `StoreTenantStaffRequest` scopes the
`exists` rule to the owner's tenant, and a test now proves the refusal rather
than trusting the rule to stay there.

## And the e2e found a second bug on its way in

The spec passed, then failed on its next run: *"the staff member was not created
at all"*. The screen said why, in full:

> **Couldn't save** — `SQLSTATE[23000]: Integrity constraint violation: 1062
> Duplicate entry 'e2e-branch-hire@shopos.test' for key 'users.users_email_unique'`

**The validation rule and the database disagreed.** The request says a removed
person's address is free again —
`Rule::unique('users','email')->whereNull('deleted_at')` — and the database had a
flat unique index that counts trashed rows. The phone carried the identical pair.

So **re-hiring somebody you had removed was impossible.** Not refused — crashed,
with the whole INSERT statement and a bcrypt hash where a sentence belonged. A
seasonal hire coming back in October is an ordinary thing in this trade.

The index is `(email, deleted_at)` now, which is what the rule always meant:
MySQL treats NULLs as distinct, so any number of removed people may hold an
address and exactly one live person may. A second test pins the half that must
NOT widen — two live people still cannot share one.

My first theory was wrong, and worth recording: I read the rule, saw
`whereNull('deleted_at')`, and concluded the email could not be the problem. The
rule was right; nothing had checked that the schema agreed with it.

*(The raw SQL reaches the screen because `APP_DEBUG=true` locally. Production
returns a generic 500 — still a crash where a validation message belongs.)*

## Held by

Six backend tests. The sharpest is the update path: `UpdateStaffAction` only
calls `fill($data)`, so it works **exactly as long as `branch_id` stays
fillable** — silently droppable for the entire life of the field. Removing it
from `$fillable` kills three of the six.

Three panel tests for the read-only label, and `e2e/staff-branch.spec.ts`, which
fills the real form and then asks the SERVER what it received — because the
absence of a control is precisely the thing a unit test cannot see.


## Gap 3, closed the same day

The four record screens that STORE a branch and never showed one: expenses,
income, stock disposals, inventory movements. Their tables all carry `branch_id`
and the API returns it — and every one of the panel's row types omitted the
field, so it arrived and was dropped. The same shape that hid a staff member's
branch, four more times.

**One hook, not four copies.** The rule is not "show a branch column", it is
"show it only where there is more than one branch to be at" — and that condition
written out four times is four chances for one of them to drift. `useBranchColumn`
holds it once.

Two label decisions, both deliberate:

| | |
|---|---|
| `branch_id` is null | reads **Main**, because that is what the server does with it — "—" would suggest it happened nowhere |
| the id is not in the list | reads **—**, and deliberately does NOT fall back to "Main" |

The second matters more than it looks. A branch can be closed while its records
remain, and **printing the wrong shop's name against a record of money is worse
than printing nothing.** The same holds mid-load, when the list is simply empty:
a page of confident wrong answers for one second is one second long enough for
somebody to read one.

**The sharpest case was the one that is not a table.** Stock movements render as
a compact list inside the adjust modal, and an owner in the all-branches view
sees "Out −3" twice with no way to tell whether that is one shop or two — on the
one figure where that distinction is the entire question.

**Two screens deliberately left alone.** Purchase orders and the cashbook have no
branch column in the database: an order is raised for the shop, and the cashbook
is derived from entries that carry their own branch. Adding one there would claim
something the record does not hold, and the Help Centre says so rather than
leaving it looking forgotten.

The test drives the exported rule rather than restating it. The first version
copied the four lines into the test file, which would have proved the copy.
