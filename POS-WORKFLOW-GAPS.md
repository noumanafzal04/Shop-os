# ShopOS POS — missing operational workflows

**How this was produced.** A 13-agent ultracode workflow swept the POS surface through six
independent lenses (counter daily loop · money controls & manager authority · multi-terminal
concurrency · business-type flows · peripherals & receipts · cashier UX & resilience), each grounded
in the actual code with `file:line` evidence. **53 gaps** came back: 20 P0, 21 P1, 12 P2. The
adversarial verify + synthesis stages died twice on API errors (session limit, then 529 Overloaded),
so the verification below is mine, done by reading the code directly.

Dated 2026-08-05, against `backend` + `admin-panel` at 793 passing tests.

---

## Already fixed in this session (Unit 5)

The audit's three most severe money-integrity findings were live bugs. All three are now closed with
tests:

| Gap | Was | Now |
|---|---|---|
| **Sale rung onto another cashier's drawer** | `cash_session_id` was validated as *any* open shift in the tenant. Cashier B could stamp their sale on cashier A's drawer — A shows a large overage, B a matching shortage, nobody can prove which. A ready-made cover for shrinkage. | `OwnOpenShift` rule on sale / return / exchange / dine-in-settle: the shift must be **yours**. |
| **`pos_require_shift` enforced nowhere** | The setting existed, validated, and had a live toggle — and *nothing read it*. A counter sale could be rung with no drawer at all, its cash in no reconciliation and no shift report. | Enforced on counter channels. **Ships off** (turning it on retroactively would have stopped one-person shops from selling); recommended on once you have staff. |
| **Two lanes could ring the same parked ticket** | Resume was "load cart, then delete". Once tickets became site-wide, two lanes opening the list together could both ring the same basket — two sales, two stock decrements, one customer. | `POST /pos/held/{id}/claim` — row-locked delete-and-return. The loser gets `HELD_ALREADY_CLAIMED`. |

**Still open from that cluster:** the drawer id is *constrained* but still client-declared. The
stronger shape is to stop accepting it entirely and resolve it server-side from the caller's open
session + `RegisterContext`. Worth doing when Unit 6 touches these actions anyway.

---

## 1. Drawer & cash handling — the biggest hole

**Every finding here traces to one fact:** `expected_cash = opening_float + cash_sales`, with no
third term. Any cash that legitimately moves for a non-sale reason is reported as a **variance**.

- **P0 · No cash-movement ledger.** Paid-in, paid-out, safe drop, float top-up, bank deposit. A
  legitimate Rs 24,500 of outflow reads as a Rs 24,500 *shortage* against the cashier — so the
  variance number, the entire point of a shift, becomes noise. On six lanes that's six fake shortages
  a day, and a real theft is indistinguishable from a supervisor's uncounted pickup.
  → `cash_movements` (session, register, type, amount, reason, `expense_id?`, created_by, approved_by)
  + `POST/GET /pos/session/movements`, folded into `expected_cash`.
- **P0 · Non-sale cash is invisible to reconciliation.** Khata repayment (money **in**) and supplier
  payment from the till (money **out**) both already record `method = cash` — and neither is tied to a
  shift. Daily reality in every mart, and each one manufactures a phantom variance.
  → server-resolved `cash_session_id` on `customer_ledger_entries` + `supplier_payments`, each also
  emitting a `cash_movements` row so one ledger drives the drawer.
- **P0 · No X-report, no Z-report, no shift history.** A shift is a write-only black hole: the cashier
  can't see expected cash before closing, the close response is computed then thrown away by the UI,
  and nothing lists past shifts. *(Partly addressed — Unit 5 added `GET /pos/sessions`, the
  consolidated day view. The live X-read for an open drawer is still missing.)*
  → `GET /pos/session/report` (live X-read: gross, refunds, discounts, tax, tender mix, movements,
  expected cash, voids) + a printable Z artifact.
- **P1 · Drawer count is a single number.** No denomination breakdown, no blind close, no over/short
  escalation threshold.
- **P1 · No store day-open / day-close, no banking deposit record.** The shop as a whole, above
  individual shifts.
- **P1 · Close reconciles cash only.** Card, wallet and khata takings are never declared or verified.
- **P2 · No-sale / drawer-open is not an event.**

## 2. Manager authority — the till-fraud controls

- **P0 · Void has no authority, no window, and erases the cash.** `CloseCashSessionAction` counts only
  Completed / PartiallyRefunded / Refunded, so a **Cancelled sale's cash tender is silently dropped
  from `expected_cash`** — ring it, pocket the cash, cancel it, and the drawer still balances. The
  audit called this the single largest cash-theft hole in the system, and I agree with that reading.
  → `sales.void` permission, mandatory reason code from a fixed enum, a time window, and cancelled
  tenders staying in the reconciliation.
- **P0 · Cart-level discount bypasses `discounts.apply` entirely.** `StoreSaleRequest::authorize`
  inspects only `items.*.line_discount`; the top-level `discount` is a plain `numeric|min:0`. Any
  cashier can key Rs 5,000 off a Rs 5,200 bill.
  → treat top-level discount like a line discount + `max_discount_percent` / `max_discount_amount`
  ceilings + `discounts.override` for a manager.
- **P0 · No cashier role, no manager override.** Everything runs off one `sales.manage` grant.
  → `sales.void`, `sales.refund`, `discounts.override`; a manager PIN re-auth at the lane.
- **P1 · Refunds have no approval, no reason codes, no tender matching, no store-credit option.**
- **P1 · No post-sale correction.** A mis-keyed tender or wrong customer can never be fixed.
- **P2 · Dine-in line voids after firing need no authority.** Food is where this leaks most.
- **P2 · No cash rounding, no tip capture.**

## 3. Receipts & peripherals — the registry drives nothing

- **P0 · The POS never actually reaches a device.** The hardware registry, the per-lane resolution
  (Unit 5) and the settings screen all exist — and no code path opens a drawer, honours
  `cut_paper`/`copies`, or prints through the lane's own printer. The drawer is the most-used
  peripheral on a cash-first counter.
  → extend `GET /pos/terminal` with effective device settings; `POST /pos/drawer/open` recording the
  event; wire the sale path to the resolved printer.
- **P0 · No reprint-last-receipt.** Top-three cashier action per shift. Today Print lives only inside
  the success modal, destroyed on New sale — the cashier must leave full-screen POS.
  → `GET /sales/{sale}/invoice?copy=reprint|gift` with a REPRINT band + a reprint trail.
- **P0 · The receipt is materially wrong for split tenders.** `invoice()` eager-loads only `items`, so
  a split-paid sale prints one "Paid (split)" line with no breakdown; cashier, branch, register,
  serials and batches are all absent.
- **P0 · Firing a KOT never prints it.** The ticket view exists and even self-prints on load — nothing
  ever opens it. Without it the dine-in module is a billing screen and orders are still shouted.
- **P1 · No sales-tax invoice fields** (NTN/STRN, FBR) for a tax-registered shop.
- **P1 · A return or exchange hands back cash with nothing printed.**
- **P1 · No workflow when the printer is down** — print failure is invisible and unrecoverable.
- **P2 · Receipt by SMS/email is orphaned** (send code must stay commented — a *recorded intent* is
  the shippable half). **P2 · shelf-tag printing isn't part of receiving/price changes.**
  **P2 · customer display has no surface to render on.**

## 4. Multi-lane operations — beyond Unit 5

Unit 5 shipped lanes, per-lane shifts + hardware, handover, force-close, the day view and the atomic
claim. What the *workflow* still needs:

- **P1 · No live drawer / X-report per lane** — an open lane's money is invisible until it closes, so a
  supervisor can't spot-check mid-day.
- **P1 · Concurrent lanes contend on the same rows** — unordered row locks (deadlock risk) and an
  unhelpful oversell failure that only surfaces at tender, after the customer is standing there.
- **P1 · No relief cover** — a cashier's namaz/tea break stops the lane dead (handover moves a drawer;
  it doesn't cover a 10-minute absence).
- **P1 · No day close / banking hand-off**, and a lane left open overnight vanishes from the board.
- **P2 · One tenant-wide invoice series for every lane**, minted under a lock held across the whole
  sale — contention grows with lane count.
- **P2 · No supervisor authorization *at the lane*** for override / void / refund.

## 5. Vertical flows — per business type

- **P0 · Kitchen loop never closes (food).** KOT is written `fired` and nothing advances it: no
  kitchen/expo screen, no ready/served bump, no reprint of a jammed ticket, `station` captured but
  routing nothing.
- **P0 · Staff cannot key a phone/WhatsApp order (mart, pharmacy).** Orders, the rider roster and
  assignment all exist — but an Order can only be created by a customer in the marketplace app. So the
  shop rings a delivery as an immediate counter sale and the whole rider flow is bypassed.
- **P1 · No floor moves (food)** — a tab can't change table, merge, or belong to a waiter.
- **P1 · No layaway / advance booking, no quotation → invoice (retail).**
- **P1 · No substitution / same-generic lookup for an out-of-stock medicine (pharmacy).**
- **P1 · Warranty desk can look a serial up but cannot take the claim in (retail).**
- **P1 · Petroleum forecourt shift** — no nozzle meter readings, no tank reconciliation, no
  rupee-amount fuel sale.
- **P2 · Rx data is captured but never becomes a dispensing register (pharmacy).**
  **P2 · no repeat-last-purchase at the counter.**

## 6. Cashier UX & resilience

- **P0 · No screen lock, switch-user, or idle timeout.** Full-screen POS drops the app header, so it
  carries no sign-out, no lock, and doesn't even show *which cashier is logged in*. Cashier B ringing
  on A's open screen stamps every sale `created_by = A` and pours the cash into A's shift — which
  quietly defeats the ownership fix above.
  → hashed `users.pos_pin`, `POST /auth/pos-unlock`, `POST /auth/pos-switch`, cashier name in the top
  bar, Lock button + `Ctrl+L`, idle auto-lock.
- **P0 · Mid-sale network failure has no timeout and no "did it go through?" recovery.** The axios
  client has **no timeout**, so a dead connection leaves Complete stuck on "Processing…" forever with a
  queue at the counter; the top-bar light says "Online" in green regardless.
  → 20s timeout, real connection state, frozen idempotency key while a checkout is in flight.
- **P1 · An in-progress cart is lost on refresh, tab crash or power blip.**
- **P1 · No customer lookup at the counter** — free-text only, and khata balance / credit limit are
  invisible *before* ringing a credit sale.
- **P1 · No quick-keys / favourites** for top sellers and barcode-less items.
- **P2 · No on-screen numeric keypad** (a touch-only terminal can't enter quantity/weight/tender).
  **P2 · no training mode.**

---

## Build order

Ordered by money-at-risk, then daily friction. Each unit is one coherent slice shipped with its edge
cases and tests.

1. **Cash movements + shift reporting.** `cash_movements` ledger folded into `expected_cash`; khata
   and supplier cash tied to the shift; live X-read; printable Z; shift history. *Unblocks: the
   variance number meaning anything at all — every other cash control reads off this.*
2. **Manager authority.** `sales.void` / `sales.refund` / `discounts.override`; cancelled tenders stay
   in reconciliation; mandatory reason codes; discount ceilings + PIN override; cart-level discount
   gated. *Unblocks: giving a stranger a cashier login.*
3. **Receipts & the drawer.** Drive the resolved per-lane printer; drawer kick; reprint + gift copy
   with a trail; split-tender/cashier/register/serials on the invoice; printer-down recovery.
   *Unblocks: the hardware registry and Unit 5's per-lane resolution finally doing something.*
4. **Till identity & resilience.** POS PIN lock / switch-user / idle timeout; axios timeout; honest
   connection state; cart survives a refresh. *Unblocks: shared terminals being trustworthy, which is
   what makes per-cashier accountability real.*
5. **Food service loop.** KOT print on fire, station routing, kitchen/expo screen with ready/served
   bump, reprint; table transfer/merge; waiter attribution; tips. *Unblocks: restaurants as a real
   vertical rather than a billing screen.*
6. **Counter-taken orders + multi-lane polish.** Staff-side phone/WhatsApp order creation into the
   existing rider flow; per-lane live drawer; ordered row locks; relief cover; day close + banking.
7. **Vertical depth.** Pharmacy substitution + dispensing register; retail layaway / quotation /
   warranty intake; petroleum forecourt shift.

Parked by standing instruction, still last: **offline PWA POS**, **deployment/CI-CD**.
