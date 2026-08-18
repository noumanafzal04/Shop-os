# The review nobody could take down

**2026-08-18.** The reachability rule, run one level up: not "does anything call
this method" but **does any client call this endpoint**.

`scripts/dead-endpoints.py` reads `php artisan route:list` and every file in the
panel and the mobile app. 294 routes under `api/v1`.

## Why a script and not a test

`tests/Unit/ReachableTest.php` asks its question inside one repo and can run on
every commit. This one has to read two sibling repositories, and a test that
fails because a directory is missing gets switched off within a week. So it is a
tool you run deliberately and read with your own eyes — and its own docstring
says what it gets wrong in both directions.

## What it found

**`DELETE /customer/reviews/{id}`** — written, tested, scoped correctly to the
signed-in customer, and called by nothing. A customer could post a review and
never take it back. The only escape was to overwrite it with something milder,
because `store()` is an upsert.

### The reason it was never wired is the more interesting half

The public list carries `customer_name` and nothing else. **No screen could tell
which review was yours.** A Remove button had nothing to point at, and the
sentence already on the page — *"posting again updates it"* — was something a
customer had to take on trust, staring at an empty form.

So the capability was unreachable because **the data needed to reach it did not
travel**.

### Why a new endpoint rather than a flag

The obvious fix is `is_mine` on the public payload. It was rejected: that
response is identical for every visitor and is cacheable in front of us, and a
body that varies with whoever holds the token is how one shopper's view gets
served to another.

`GET /customer/reviews` instead, inside the authenticated customer group beside
`/customer/favorites` and `/customer/addresses`. Unpaginated, and that is a real
bound rather than an oversight: one review per shop, and a person reviews the
shops they buy from.

The panel now prefills the box with your own words (keyed on the review id, so
typing is never overwritten by a refetch), badges your row **Yours** in the
list, and offers **Remove** through the shared confirm dialog.

## Two bugs in the audit itself

**Stripping the wrong thing.** First run: 5 findings, 3 of them noise. A client
that builds its path from a variable — ``apiGet(`${basePath}/presets`)`` — does
not contain the literal route. The matcher now retries with the leading segments
wildcarded.

**A cutoff that was one character too long.** The retry required the remaining
static tail to be ≥ 8 characters. `presets` is 7. So `staff/presets` was reported
dead while `useJobPresets` was calling it. A threshold is a guess; this one is
now written down with what it cost.

Down to one candidate — `GET /admin/staff/{staff}`, a REST *show* returning a row
the list already carries. Surplus surface, not a missing capability.

## And a guard test that could not read its own subject

Adding the Remove button failed `destructive.test.ts` — *"danger is never the
primary action of a screen"*. The rule was right; its parser was not. Its word
list is anchored (`/^(Remove|Delete|…)/`), and a button with a pending state
writes its label as a ternary:

```tsx
{deleteReview.isPending ? "Removing…" : "Remove review"}
```

which starts with `{deleteReview`. **Every destructive button with a spinner was
invisible to that rule, in both directions.**

Teaching it to read the string literals out of an expression immediately turned
up two real ones the Aug-17 sweep had missed: the delete confirmations on
**Products** and **Categories** were rendering the brand colour, so the button
that deletes a product was the same button as Save. Both now match the shared
confirm dialog's filled red.

> A guard test that cannot parse the thing it guards reports a clean sweep.

## Gates

Backend **2053** green (+5) · pint clean · panel **903** green (+1) · eslint
0 errors / 18 warnings · build clean.

---

## 2026-08-18, later — the other direction, and a warning that was not true

The script asked one question: *which routes does no client call?* That finds
capability nobody can reach, which costs nothing until somebody needs it. It
never asked the reverse — **which client calls does no route serve?** — and that
one has a customer holding the consequence: a 404 in the hand, on a screen that
compiles perfectly.

It compiles because **the clients describe the API in their own hand-written
types.** A path renamed on the server changes nothing a typecheck can see. Nor
can the mobile app's own suite see it: those 31 tests mock the API, so they agree
with whatever the app already believes.

A third question came with it — **a real route called with the wrong verb** —
because a 405 reads to a shopkeeper as "the button does nothing", which is the
report you get and the thing you then cannot reproduce.

### What prompted it

`HANDOVER.md` had warned since July that the mobile apps' contracts had "moved
under them", naming `item_types`, `other_income` and `logo_url`. **Nothing had
ever checked.** It was prose, and prose is not checked — the same reason
`shopos:readiness` exists.

### The answer

| | |
| --- | --- |
| call sites read | **359** |
| reach a route that serves that verb | **359** |
| hit nothing | 0 |
| wrong verb | 0 |
| unresolvable (variable path head) | 4 |

`tsc` clean on the mobile app, 31 tests pass, and its `Tenant` type matches
`TenantResource` on all three named fields. `other_income` does not appear in the
mobile app at all.

**The warning was not true, and had not been for some time.** The customer app is
behind on features, not out of contract. A stale caution is not harmless: it
sends the next person hunting a defect that does not exist, and it teaches them
that the cautions in this file are approximate.

### Why the clean result is worth believing

Because it was made to fail first. Two probes were planted and both were caught:

```
NO ROUTE   GET    /marketplace/shoppes/${slug}
WRONG VERB POST   /auth/me   route allows GET
```

The unresolvable count is printed rather than dropped, and the run aborts if it
reads zero calls — **a checker that silently discards what it cannot parse
reports a clean sweep it did not earn**, which is the lesson this codebase paid
for three times in one day. Test files are excluded from this half and not from
the other: a test may legitimately name a path no route serves, because that is
how you assert a 404.
