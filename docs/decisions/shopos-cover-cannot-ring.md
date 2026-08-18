# The reliever could not ring

**Found and fixed 2026-08-18**, while wiring the offline shift mirror — the two
share one line of code and one wrong question.

Relief cover exists so a cashier can step away without the lane stopping:
someone else takes the till and **rings under the cashier's drawer**. The rule
the whole feature turns on is *a cover moves the queue, not the drawer* — sell
yes, reconcile never.

`/pos/session` answers with one of three things: my own drawer, the drawer I am
covering, or nothing. The till narrowed them like this:

```tsx
const covering = isCover(session.data) ? session.data : null;
const open     = covering ? null : session.data;      // null under cover, by design
```

`open` being null under cover is **correct** — a cover carries the shift id to
ring against and none of the figures the cashier will be measured on, and the
X-read panel asks `!!open` for exactly that reason.

Then both selling gates asked the same question:

```tsx
const canCheckout = cart.length > 0 && !!open && …
<button disabled={cart.length === 0 || !open}>Tender / Pay</button>
{!open && <p>Open a shift to sell.</p>}
```

So a reliever standing at the till saw **"Open a shift to sell."** with Tender
greyed out — while `activeSessionId` and the sale payload beside it were already
built to carry the covered session's id. Everything downstream of the button
worked. The button was off.

## The question was wrong, not the value

Two questions that look like one:

| Question | Answer under cover | Right for |
| --- | --- | --- |
| *Do I have a drawer of my own?* (`!!open`) | no | reconcile — X-read, close, count |
| *Is there a drawer to ring into?* | yes | selling |

`ringableSessionId(session)` now answers the second, and the selling gates use
it. Reconcile actions keep asking the first, because a cover may sell and must
never count the drawer.

It also answers `null` for a **closed** drawer, which matters more since the
shift mirror landed: a remembered shift could come back closed after a reload,
and a counted drawer is not a shift to sell into.

## The test file named this exact failure

`cover.test.ts` opens by saying the narrowing must not

> hand a reliever the cashier's expected cash **or leave them unable to ring at
> all**

and then tests only `isCover` and `isTraining` — the type predicates, which were
never the part that was wrong. The consequence it names in prose was not
asserted anywhere.

> A test file that describes the failure and then checks something adjacent is
> the most convincing kind of missing test: it reads as covered.

Same family as the guard tests that passed while blind to their own subject, and
the reason the fix is a named function rather than a corrected expression — a
rule that lives in a boolean inside a 3,000-line component gets re-derived
wrongly the next time somebody touches it.
