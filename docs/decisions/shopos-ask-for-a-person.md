# Ask for a person

**2026-08-25 · backend + panel**

## The page was written for one visitor out of three

The landing page had exactly one way forward: **Try the demo**, which builds a
working shop in a tap and asks for nothing. That is the right answer for the
shopkeeper who will try software on their own, and it is the wrong answer for
two others, both of whom read the whole page and then left it:

- the one who will not touch software until a person has walked them through it
- the one with a single question standing between them and buying

Neither is *less* interested than a demo visitor. Both are further along.

## What was built

`enquiries` — a table, a public endpoint, an admin queue.

- `POST /api/v1/enquiries` — unauthenticated, throttled 3/min and 10/hour per
  IP. **A name and an email is the whole requirement.** Everything else is
  optional, because demanding a company name, a city and a trade from somebody
  who wants to ask one question is how a form gets closed instead of sent.
- `GET /api/v1/admin/enquiries` and `PATCH /api/v1/admin/enquiries/{id}` —
  gated on `tenants.create`, the same permission as shop requests. Whoever may
  open a shop is whoever talks to the people asking for one.
- `/admin/enquiries` in the panel, **on the rail**, oldest first, with the age
  of the oldest printed at the top.

## It does not book anything, and it does not pretend to

`prefers_at` is when somebody would *like* to be shown around. No slot is held,
no diary is written to. The confirmation says a person will write back to
confirm it, and the admin card says "**Wants** a time around Fri, 28 Aug".

A form that announced "your demo is confirmed for Tuesday 4pm" while no such
thing exists would make the first promise this product ever makes to a stranger
one it cannot keep.

The panel converts the picker's value to an instant before sending. A
`datetime-local` gives `2026-09-01T16:00` with no zone, the server reads it in
its own, and a time two hours away can arrive already in the past — refused by
`after:now` for no reason the visitor can see.

## The city is a string

Not a foreign key to `cities`, and `business_name` is checked against nothing.
This is a **lead**, not a tenant: the person filling it in has no account, will
type "Karachi (Gulshan)", and must not be refused for a bracket. Setup asks
these questions properly, against the real lists, once they are a shop.

## Two queues, not one

A question wants answering today. A walkthrough wants half an hour in
somebody's week. Sorted into one queue the quick ones sit behind the slow ones,
which is how a same-day question takes four days. `kind` splits them and the
admin screen filters on it.

## A test that passed against its own bug, twice over

`test_the_person_who_has_waited_longest_is_offered_first` was written with the
oldest row inserted first — so a query with **no `ORDER BY` at all** handed back
the right answer, and deleting the ordering did not fail it.

Reversing the insert order did not fix it either. SQLite serves the open queue's
`whereIn('status', …)` from the `(status, created_at)` index, and an index scan
returns rows in `created_at` order **by accident of the index**. The clause was
still unproven.

The test that actually pins it reads the *unfiltered* list, where there is no
index to fall back on. Deleting `->orderBy('created_at')` now fails it, which
is the only evidence that the ordering is doing anything.

That second listing needed `status=all` to exist as a real branch. It used to
be whatever fell through the filters — **a filter that silently returns
everything when it does not recognise its own argument is a filter you cannot
trust** — so an unknown status is now a 422.

## The guard the admin side never had

This codebase has shipped **seven** screens that were built, routed, tested and
completely unreachable. The shop side grew a guard after the fourth. The admin
side never did, and the admin rail is exactly where it happens: the route is one
file and the menu item is another.

`e2e/adminScreensAreReachable.guard.ts` reads both files and refuses to let them
disagree, in both directions — a screen nothing offers, and a rail row with no
route behind it. Delete the Enquiries row from the sidebar and it fails by name.

**It was wrong on its first run**, and the way it was wrong is the point. It
modelled one route shape — `RequireAdminScreen path="/admin/…"` — and reported
the Help Centre as a dead menu row. The Help Centre is routed perfectly well; it
simply has no permission gate, deliberately, because a screen you need in order
to work out the navigation must not be behind the navigation's own rules.
*Suspect the parser before the code.*

It carries a denominator: the file asserts it found at least eight paths on each
side, because a regex that silently matches nothing turns the whole guard into a
test that passes for having looked at an empty set.

## Not in the Help Centre, and why

The standing rule is that a screen change updates `help/content.ts`. This one
does not, and the reason is in `HelpCenterPage.tsx:46`: the `permission` filter
returns **true for any permission when the reader is a shop owner**. An
admin-only article gated on `tenants.create` would therefore appear for every
shopkeeper in the product. The landing page is pre-login and the enquiry queue
is platform staff's — neither is that Centre's subject.

## Also

`.env.example` still said `APP_NAME=Laravel`, and `MAIL_FROM_NAME` is built
from it — so a fresh install signed its outgoing email "Laravel". Now `CartZe`.
