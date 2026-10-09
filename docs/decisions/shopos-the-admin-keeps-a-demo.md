# The admin keeps a demo shop for its owner

**2026-10-09 · asked for by the owner**

> "Jo DEMO shop create hoti landing page py, wo approve kaise hoti jb tk tenant
> apni info ni add kr deta Keep-this-shop main? Admin direct b kr skta hai — wo
> kahin nzr ni aya admin side py. Ye b admin side py krna."

## What there was

A demo became a business in exactly one way: its visitor pressed **Keep this
shop**, typed a contact and a password, and waited for an admin to say yes.
That is right for a stranger who found the landing page alone.

It was the only way, and the admin side showed nothing else. A demo nobody had
"requested" was a number on the dashboard ("Trying it 8") and a row behind a
filter in the tenant list whose page looked exactly like a real shop's. Somebody
from the platform sitting beside a shopkeeper who had just said *theek hai, yehi
chahiye* had nothing to press.

## What there is

**Demo shops** (the screen that was "Shop requests", same address) has two lists:

- **Asked to stay** — the queue, oldest first, as before. Still what the page
  opens on and what the rail's badge counts: those are people waiting.
- **Trying it now** — every demo, newest first, with what has been done in it:
  how much is on the shelf, how many sales were rung and for how much, when the
  last one was, and how long it has left. A demo has a generated name and
  nobody's name on it; this is how one is told from another.

Each row offers **Make it a real shop**. So does a demo's own page, in a banner
that says it is a demo, that nobody can sign in to it, and when it ends.

## The decisions

**It asks for the owner's sign-in, and that is not optional.** A demo is
entered by a token and nothing else — the account was opened with a throwaway
address and a random password nobody was ever told. A shop made real with that
account is a shop its owner cannot get back into tomorrow. A name, an email and
a password: the same things *Keep this shop* asks.

**The password is shown, not dotted, and can be suggested.** It is about to be
said across a counter. `suggestPassword()` makes one for saying: four letters,
four digits, four letters; no i, l, o, 0 or 1.

**The shop's name is optional.** The owner is sent back through setup and asked
it there — but an admin who knows it should not leave a real shop on the list as
"Mart Demo K7QP". Held to the same no-two-alike rule as every shop's name.

**Not the plan.** Giving a shop a plan is recording what it paid, which has its
own screen and its own arithmetic. After keeping, the admin lands on the shop's
page, where that is done.

**Kept either way, it is the same kind of shop.** What changes is written once,
on the shop — `Tenant::becomeABusiness()` — and both `ApproveShopRequestAction`
and the new `KeepDemoShopAction` call it: no longer a demo, no clock, back
through setup, and stamped with the door it came in by (so it is found under
"Kept their shop").

**A demo whose owner already asked is offered Approve, not the form.** They
chose their own password when they asked; the form would write a new one over
it. (The endpoint still copes if it is used on such a shop: the waiting request
is answered — approved, by that admin — so nobody is left "waiting" for a shop
they have.)

**A demo past its day can still be kept.** The clearing-away is a job on a
timer, not a wall. The row says "Past its day" in amber, not red.

**Who kept it is on the shop's own trail** (`demo_shop_kept_by_admin`), with the
name it had and the name it was given. The password is not written anywhere.

## Found on the way: a demo was on a plan that did not exist

`CreateDemoShopAction` looked its plan up by NAME — `where('name', 'Premium')`,
"the plan that shows what the product actually does". That plan was renamed
Standard, the lookup found nothing, and every demo since has had no plan.
Nothing noticed, because nothing it was for depends on it any more: what a shop
can do is its module list, proposed by its trade; a plan's ceilings could only
take something away from a visitor; and a plan is a thing somebody paid for.

So it is now said rather than happened upon: **a demo is on no plan.** Kept, it
gets one from the admin, and that is the first payment on its ledger — it no
longer arrives already "subscribed" for a month nobody recorded.

## Not done

- No "give it another day" button. A demo past its day can be kept; one that
  simply needs longer cannot be extended from the console.
- The dashboard's "Trying it" chip is not a link to the list.
- Demos are not searchable — the list is newest first and a page is 25.

## Tests

`TheAdminKeepsADemoShopTest` (20; mutations 35/35), `suggestPassword.test.ts`,
`demoClock.test.ts`, `e2e/admin-demo-shops.spec.ts` (browser mutations 15/15) —
opens a demo through the front page's own door, rings a sale in it, keeps it
from the admin side and signs in as its owner.
