# A refund is approved with a PIN; an ingredient is kept and not sold

Date: 2026-10-15. Bugs: B01 (owner's answer), B52–B62 from tester passes 4–5, B11, B12, B32, B33.
Code: backend `offline/v1/backend`, panel `offline/v1/admin-panel` (see the commit that names these bugs).

## A refund leaves the cashier's own drawer, with a supervisor's yes (B01)

The owner (2026-10-14): cash going back comes out of the drawer the sale's
money went into, a supervisor approves it with their PIN, and the approval is
kept. Built that way:

- The cashier starts the return or exchange at their own till. If they hold
  `sales.refund`, nothing more is asked. If not, the sheet asks for an approver
  (anyone at the shop holding `sales.refund`, with a till PIN, not locked) and
  that person's PIN, typed on the cashier's screen.
- A supervisor with no drawer of their own may choose an open drawer at the
  SAME place, and must then also give a PIN. Never another place's drawer,
  never quietly.
- The PIN is the till PIN people already have: same lock-out after wrong
  tries, same refusal for a disabled account. `SupervisorApproval::verify`.
- What is kept: `sale_returns.approved_by` / `approved_at`, and an audit row
  (event `approved`) with the amount, who did it, who approved it and whose
  drawer it came from.

## An item can be kept and not sold (B62)

`products.for_sale` (default true). Off = counted, bought on a PO, used up by
recipes — never on the till's sync (sent as a tombstone), the till's search,
a table's menu, Take order or the storefront (`visible_in_marketplace` is
forced off on save), and refused by name (`NOT_FOR_SALE`) on every way of
selling: till sale, tab, phone/online order, quotation/layaway. A line captured
earlier (a tab being settled, an order completed) is not re-checked — same rule
as `is_active`. The switch is "Sold to customers" on Details, for packets and
kitchen-made items. Refusing every 0-priced line was rejected: a free item
can be real.

## A packet keeps its opening lot (B60)

A medicine with opening stock always gets a lot. Anything else gets one only
when its maker gave a batch number or an expiry — then the opening stock IS
that lot. The form offers both (optional) for packets.

## Smaller rules made in this batch

- **Fuel on the reorder list** is left out of the drafts by name and its row
  says "Comes by tanker" (B54); a list of fuel alone is refused
  `FUEL_COMES_BY_TANKER`.
- **What the shop pays the platform** (plan price, the bill) is not sent to a
  person of that shop without `settings.manage`, in `/auth/me` or `/shop`;
  the platform's own screens still get it (B55). The Subscription route sits
  inside the screen gate (B56); a new guard test fails any route whose screen
  has a rule and no gate above it.
- **A key is kept from the first press** until the thing is saved, on every
  form that records something (useOnceKey). Four still minted one per press:
  park as quote/layaway (with its advance), Bill & hand over, Take order and
  the storefront checkout. A guard test fails any `idempotency_key: uuid()`.
- **An empty bill is not asked about** (`asksAbout`) — exchange, New sale and
  Take order sent `items: []` a moment before the first line (B52, B27).
- **A refused offline sale shows its amount** — the till's own total is kept
  on the queued row (`tillTotal`) for that list only (B57).
- **The receipt says the unit of a weighed line and why a bulk rate was
  charged** — `ReceiptLine`, read off the product (B59).
- Dashboard: no loading pills for a person sent no takings (B53); the
  "orders waiting for you to accept" line only for someone who can open
  Orders, and no "nothing rung up yet" to someone not sent the sales (B58).
- The medicine receive sheet holds Receive until every line coming in has an
  expiry (B61).
