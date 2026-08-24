"""
Phase C — selling, and whether the money and the shelf agree afterwards.

The chain every shop runs a hundred times a day, in order, per trade:

    open the drawer → put something on the shelf → ring it → take a return
    → void one → move cash → read the drawer → count it out

Each step is checked against the two ledgers a shop actually lives by:

    THE SHELF   stock down by what was sold, back up by what was returned
    THE DRAWER  expected cash = float + cash taken + paid in − paid out

A step that "succeeds" while leaving those two disagreeing is the failure this
phase exists to find, because it is the one nobody notices until the counting
happens at ten at night and the numbers are already a day old.
"""

from api import Api, Report
from shelf import on_hand

CASH = "cash"

# What to put on the shelf, per item type. The trade decides which of these it
# is allowed to create — Phase B already read that off the tenant.
STOCK_QTY = 100
PRICE = 500.0


# Shops that keep BOOKS but have no till.
#
# `sold` means "a shop that can ring a sale", and thirteen phases index
# `state["product"]` without asking — so a product-less state cannot go in it.
# But a shop with no till still has expenses, income, a cashbook and a profit
# figure, and `finance` is a whole business type made of exactly those: its only
# module is `expenses`.
#
# Because phase C skipped it outright, every phase after C read phase C's output
# and 17 of 19 never touched it. **The one type whose entire product IS the
# money screens had never been driven end to end.** This dict is how phase E
# reaches it, and nothing else has to change.
BOOKS_ONLY: dict[str, dict] = {}


def run(api: Api, rep: Report, shops: dict) -> dict:
    out: dict[str, dict] = {}
    BOOKS_ONLY.clear()

    for code, shop in shops.items():
        token = shop["token"]

        # No till, no phase. An online-only shop is not broken for lacking one.
        if not shop.get("features", {}).get("pos"):
            rep.ok("C", f"{code} · no till module", "skipped, correctly")
            BOOKS_ONLY[code] = {
                "token": token,
                "features": shop.get("features") or {},
                "primary": shop.get("primary") or code,
            }
            continue

        item_type = _sellable_type(shop.get("item_types") or [])
        if item_type is None:
            rep.query("C", f"{code} · has something it may sell", f"item_types={shop.get('item_types')}")
            continue

        product = _ensure_product(api, rep, code, token, item_type)
        if product is None:
            continue

        session = _open_shift(api, rep, code, token)
        if session is None:
            continue

        state = {"product": product, "session": session, "item_type": item_type,
                 "token": token, "features": shop.get("features") or {},
                 "primary": shop.get("primary") or code,
                 "item_types": shop.get("item_types") or []}
        _server_prices_it(api, rep, code, token, state)
        _stock_moves(api, rep, code, token, state)
        _return_restocks(api, rep, code, token, state)
        _void_restocks(api, rep, code, token, state)
        _drawer_adds_up(api, rep, code, token, state)
        _close(api, rep, code, token, state)

        out[code] = state

    return out


# ── the shelf ──────────────────────────────────────────────────────────

def _sellable_type(item_types: list) -> str | None:
    """Whatever this trade may actually create, most stock-like first."""
    for t in ("physical_product", "medicine", "food", "service"):
        if t in item_types:
            return t
    return item_types[0] if item_types else None


def _ensure_product(api: Api, rep: Report, code: str, token: str, item_type: str) -> dict | None:
    """One product this sweep owns, reused across runs, restocked each time."""
    name = f"Sweep Item ({item_type})"

    status, body = api.get(f"/products?search={name.replace(' ', '+')}", token=token)
    rows = _rows(body)
    found = next((r for r in rows if r.get("name") == name), None)

    if found is not None:
        found = _repriced(api, rep, code, token, found)
        found = _restock(api, rep, code, token, found, item_type) if found else None
        if found is not None:
            rep.ok("C", f"{code} · reuse product")
            return found

    payload = {
        "item_type": item_type,
        "name": name,
        "price": PRICE,
        "cost": 300,
        "tax_rate": 0,
    }
    if item_type != "service":
        payload |= {"track_inventory": True, "stock_quantity": STOCK_QTY}
    if item_type == "medicine":
        # A medicine lot with no expiry is a lot nobody can pull off the shelf
        # on time. The server refuses it, and that refusal is the feature.
        payload |= {"expiry_date": "2030-12-31", "opening_batch_number": "SWEEP-1"}

    status, body = api.post("/products", payload, token=token)
    if status not in (200, 201):
        rep.bug("C", f"{code} · create product", f"{status} {body.get('errors') or body.get('message')}")
        return None

    rep.ok("C", f"{code} · create {item_type}")
    return body.get("data") or {}


def _repriced(api: Api, rep: Report, code: str, token: str, product: dict) -> dict | None:
    """
    Put the shelf price back to what every later assertion is computed from.

    "Reuse what you find" quietly inherits whatever the last run left behind,
    and this product's PRICE is not incidental — the tenders downstream are
    literal figures worked out from `PRICE`, so a product 37.50 higher makes the
    server refuse a basket and the sweep report it as a product bug.

    That is not hypothetical. A probe in phase T re-priced this very item, twice,
    and the next run printed "amount paid is less than the total" as SIX BUGS in
    six shops. The product was correct; the fixture had drifted.

    Restocking was already done here for exactly this reason. The price belongs
    beside it: a re-runnable fixture has to find its subject not merely present
    but in the STATE it needs.
    """
    if abs(float(product.get("price") or 0) - PRICE) < 0.01:
        return product

    was = product.get("price")
    status, body = api.put(f"/products/{product['id']}", {
        "name": product["name"], "price": PRICE, "tax_rate": 0,
    }, token=token)

    if status != 200:
        rep.bug("C", f"{code} · put the shelf price back", f"{was} → {PRICE} refused: {status}")
        return None

    rep.ok("C", f"{code} · shelf price put back", f"{was} → {PRICE}")

    return (body.get("data") or {}) or product


NEEDED = 20.0   # one pass rings 3 + 2 + 2 and returns some; 20 is comfortable


def _restock(api: Api, rep: Report, code: str, token: str,
             product: dict, item_type: str) -> dict | None:
    """
    Put the shelf back before selling from it again.

    NOT with `PUT /products/{id}` — `stock_quantity` there is **prohibited**,
    with the message "Stock changes go through inventory adjustments", and it is
    right: a quantity typed into an edit form leaves no movement behind and no
    trace of who typed it. The sweep spent several runs quietly failing to
    restock because it ignored that 422, and eventually rang into an empty shelf
    and reported "Insufficient stock" as five product bugs.

    A shop without the inventory module has no adjustment endpoint at all, so
    there the product is replaced instead. Both paths end with a full shelf,
    which is all the later phases need.
    """
    if item_type == "service":
        return product

    have = _stock_of(api, token, product["id"])
    if have is not None and have >= NEEDED:
        return product

    status, _ = api.post("/inventory/adjust", {
        "product_id": product["id"], "type": "set",
        "new_quantity": STOCK_QTY, "reason": "QA sweep restock",
    }, token=token)
    if status in (200, 201):
        return _reread(api, token, product["id"]) or product

    # No inventory module: start the product again rather than sell into a
    # shelf that cannot be refilled.
    api.delete(f"/products/{product['id']}", token=token)
    rep.ok("C", f"{code} · shelf could not be adjusted, product replaced", f"had {have}")
    return None


def _reread(api: Api, token: str, pid: str) -> dict | None:
    status, body = api.get(f"/products/{pid}", token=token)
    return (body.get("data") or {}) if status == 200 else None


def _stock_of(api: Api, token: str, product_id: str) -> float | None:
    """The shelf this till sells from — see shelf.py for why not the rollup."""
    return on_hand(api, token, product_id)


# ── the drawer ─────────────────────────────────────────────────────────

def _open_shift(api: Api, rep: Report, code: str, token: str) -> dict | None:
    """An open drawer, whether or not the last run left one behind."""
    status, body = api.get("/pos/session", token=token)
    live = (body.get("data") or {}) if status == 200 else {}

    if live.get("id") and live.get("status") == "open":
        rep.ok("C", f"{code} · drawer already open")
        return live

    status, body = api.post("/pos/session/open", {"opening_float": 1000}, token=token)
    if status not in (200, 201):
        rep.bug("C", f"{code} · open drawer", f"{status} {body.get('message')}")
        return None

    rep.ok("C", f"{code} · open drawer · float 1000")
    return body.get("data") or {}


# ── the checks with teeth ──────────────────────────────────────────────

def _server_prices_it(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    The one that must never bend.

    A client that can name its own `unit_price` can settle a Rs 50,000 bill for
    one rupee, and no report downstream would look wrong — the sale would simply
    say it was worth a rupee. So the sweep sends the attack: a rupee, and a tax
    of zero, on a product priced 500. The server must price it at 500 anyway,
    and it must not error either — SILENTLY DROPPING the field is the design,
    because a shop with an old client should keep selling at the right price
    rather than stop selling.
    """
    poisoned = {
        "channel": "pos",
        "cash_session_id": state["session"].get("id"),
        "items": [{
            "product_id": state["product"]["id"],
            "quantity": 2,
            "unit_price": 1,        # ← must be ignored
            "line_total": 2,        # ← must be ignored
        }],
        "tax": 999,                 # ← must be ignored
        "payment_method": CASH,
        "amount_paid": 1000,
    }
    status, body = api.post("/sales", poisoned, token=token)
    if status not in (200, 201):
        rep.bug("C", f"{code} · sale with a client price", f"{status} {body.get('errors') or body.get('message')}")
        return

    sale = body.get("data") or {}
    total = float(sale.get("total") or 0)
    tax = float(sale.get("tax") or 0)

    if abs(total - 2 * PRICE) > 0.01:
        rep.bug("C", f"{code} · SERVER PRICES THE SALE", f"client said 2, server charged {total}")
    else:
        rep.ok("C", f"{code} · client price ignored", f"charged {total:.0f} not 2")

    if tax > 0.01:
        rep.bug("C", f"{code} · client tax ignored", f"tax = {tax}")

    state["priced_sale"] = sale
    state["cash_taken"] = state.get("cash_taken", 0.0) + total


def _stock_moves(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """Selling two of something leaves two fewer of it."""
    if state["item_type"] == "service":
        rep.ok("C", f"{code} · service holds no stock", "skipped, correctly")
        return

    before = _stock_of(api, token, state["product"]["id"])
    sale = _ring(api, rep, code, token, state, qty=3)
    if sale is None or before is None:
        return

    after = _stock_of(api, token, state["product"]["id"])
    if after is None:
        rep.query("C", f"{code} · stock readable after sale", "no stock_quantity")
        return

    if abs((before - after) - 3) > 0.001:
        rep.bug("C", f"{code} · SELLING TAKES STOCK OFF THE SHELF", f"{before} → {after}, sold 3")
    else:
        rep.ok("C", f"{code} · sale took 3 off the shelf")

    state["stock_sale"] = sale


def _return_restocks(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """A refund puts the goods back — once, and only what came back."""
    sale = state.get("stock_sale") or state.get("priced_sale")
    if not sale:
        return

    items = sale.get("items") or []
    if not items:
        rep.query("C", f"{code} · sale carries its lines", "no items on the response")
        return

    before = _stock_of(api, token, state["product"]["id"])
    status, body = api.post(f"/sales/{sale['id']}/returns", {
        "items": [{"sale_item_id": items[0]["id"], "quantity": 1}],
        "reason": "QA sweep partial return",
        "refund_method": CASH,
        "cash_session_id": state["session"].get("id"),
    }, token=token)

    if status not in (200, 201):
        rep.bug("C", f"{code} · partial return", f"{status} {body.get('errors') or body.get('message')}")
        return

    # `refund_total`, not `total`. The first run read `total`, saw zero, and
    # reported a refund that moved no money — while the drawer's own figure was
    # 500 lower, which is the sweep contradicting itself in the same run. When
    # two of your own numbers disagree, one of them is the harness.
    refund = float((body.get("data") or {}).get("refund_total") or 0)
    state["cash_taken"] = state.get("cash_taken", 0.0) - refund
    rep.ok("C", f"{code} · returned 1 · refunded {refund:.0f}")

    if state["item_type"] == "service" or before is None:
        return

    after = _stock_of(api, token, state["product"]["id"])
    if after is not None and abs((after - before) - 1) > 0.001:
        rep.bug("C", f"{code} · RETURN PUTS IT BACK", f"{before} → {after}, returned 1")
    elif after is not None:
        rep.ok("C", f"{code} · return put 1 back")


def _void_restocks(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    Voiding a whole sale returns everything on it.

    Kept separate from the refund above because the two have their own paths,
    and a shop that voids what it should have refunded (or the reverse) is how
    the same goods get restocked twice — the stock-loss bug class this codebase
    has already been bitten by.
    """
    sale = _ring(api, rep, code, token, state, qty=2, label="to void")
    if sale is None:
        return

    before = _stock_of(api, token, state["product"]["id"])
    # `reason_code` from a fixed list, with free text optional beside it. A
    # free-text-only void is unreportable: "why do we void forty sales a week"
    # cannot be answered by reading forty sentences. The list is the feature.
    void = {"reason_code": "test_sale", "reason": "QA sweep void"}
    status, body = api.post(f"/sales/{sale['id']}/cancel", void, token=token)

    if status not in (200, 201):
        rep.bug("C", f"{code} · void a sale", f"{status} {body.get('errors') or body.get('message')}")
        return

    state["cash_taken"] = state.get("cash_taken", 0.0) - float(sale.get("total") or 0)
    rep.ok("C", f"{code} · voided a sale")

    if state["item_type"] == "service" or before is None:
        return

    after = _stock_of(api, token, state["product"]["id"])
    if after is not None and abs((after - before) - 2) > 0.001:
        rep.bug("C", f"{code} · VOID PUTS IT ALL BACK", f"{before} → {after}, voided 2")
    elif after is not None:
        rep.ok("C", f"{code} · void put 2 back")

    # And it must not be voidable twice — that is the double-restock.
    status, _ = api.post(f"/sales/{sale['id']}/cancel", void, token=token)
    if status in (200, 201):
        again = _stock_of(api, token, state["product"]["id"])
        rep.bug("C", f"{code} · SALE VOIDED TWICE", f"stock now {again}")
    else:
        rep.ok("C", f"{code} · second void refused", f"{status}")


def _drawer_adds_up(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    Non-sale cash, then the X-read.

    The drawer's expected figure is the only number a cashier is judged
    against. If a paid-out does not come off it, the honest cashier is short
    every night and nobody can say why.
    """
    # The drawer BEFORE the movements. Assuming a 1,000 float and no prior cash
    # was only true on a virgin shop: this sweep reuses an open shift between
    # runs on purpose, so on the second run the figure legitimately included
    # yesterday's takings and the check reported the shop's correct arithmetic
    # as something to look at. A sweep that cries wolf teaches people to ignore
    # it, which is worse than the check not existing.
    #
    # So: measure the DELTA. That is also the actual claim — a paid-out has to
    # come OFF the expected figure — and it is true whatever the drawer already
    # held.
    before_cash = _expected_cash(api, token)

    for kind, amount in (("paid_in", 200), ("paid_out", 150), ("no_sale", None)):
        payload = {"type": kind, "reason": f"QA sweep {kind}"}
        if amount is not None:
            payload["amount"] = amount
        status, body = api.post("/pos/session/movements", payload, token=token)
        if status not in (200, 201):
            rep.bug("C", f"{code} · {kind}", f"{status} {body.get('message')}")
            return

    rep.ok("C", f"{code} · paid in 200, paid out 150, no-sale")

    status, body = api.get("/pos/session/report", token=token)
    if status != 200:
        rep.bug("C", f"{code} · X-read", f"{status}")
        return

    # The X-read is `{session, drawer, movements, …}` — the money is under
    # `drawer`, and reading the envelope's top level finds nothing. Blind close
    # UNSETS `expected_cash` on purpose, so absence is only a finding when the
    # shop is not blind: the whole point is that the person being counted does
    # not get told the answer first.
    d = body.get("data") or {}
    drawer = d.get("drawer") or {}
    expected = drawer.get("expected_cash")

    if expected is None:
        if d.get("blind_close"):
            rep.ok("C", f"{code} · blind close hides the answer")
        else:
            rep.bug("C", f"{code} · X-read names expected cash", f"drawer keys: {sorted(drawer)}")
        return

    state["expected_cash"] = float(expected)

    if before_cash is None:
        rep.query("C", f"{code} · drawer arithmetic", "no expected figure before the movements")
        return

    # +200 in, −150 out, and a no-sale moves nothing at all.
    moved = round(float(expected) - before_cash, 2)

    if abs(moved - 50) > 0.01:
        rep.query("C", f"{code} · drawer arithmetic",
                  f"paid in 200 and out 150, so the expected figure should have moved +50; "
                  f"it went {before_cash:.2f} → {float(expected):.2f} ({moved:+.2f})")
    else:
        rep.ok("C", f"{code} · drawer adds up", f"{before_cash:.0f} +50 → {float(expected):.0f}")


def _expected_cash(api: Api, token: str) -> float | None:
    """What the drawer says it should hold, or None (blind close, or no shift)."""
    status, body = api.get("/pos/session/report", token=token)
    if status != 200:
        return None
    value = ((body.get("data") or {}).get("drawer") or {}).get("expected_cash")

    return None if value is None else float(value)


def _close(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """Count it out exactly, and the shift must record no variance."""
    counted = state.get("expected_cash")
    if counted is None:
        counted = 1000 + state.get("cash_taken", 0.0) + 50

    status, body = api.post("/pos/session/close", {
        "counted_cash": round(float(counted), 2),
        "notes": "QA sweep close",
    }, token=token)

    if status not in (200, 201):
        rep.bug("C", f"{code} · close drawer", f"{status} {body.get('errors') or body.get('message')}")
        return

    d = body.get("data") or {}
    variance = d.get("variance")
    rep.ok("C", f"{code} · closed", f"counted {float(counted):.0f}, variance {variance}")

    if variance is not None and abs(float(variance)) > 0.01:
        rep.query("C", f"{code} · exact count shows no variance", f"variance = {variance}")

    # Closed means closed: the till must not still be sellable.
    status, body = api.get("/pos/session", token=token)
    still = (body.get("data") or {}) if status == 200 else {}
    if still.get("status") == "open":
        rep.bug("C", f"{code} · drawer stays closed", "session still reads open")
    else:
        rep.ok("C", f"{code} · drawer reads closed")


# ── plumbing ───────────────────────────────────────────────────────────

def _ring(api: Api, rep: Report, code: str, token: str, state: dict, qty: float,
          label: str = "") -> dict | None:
    status, body = api.post("/sales", {
        "channel": "pos",
        "cash_session_id": state["session"].get("id"),
        "items": [{"product_id": state["product"]["id"], "quantity": qty}],
        "payment_method": CASH,
        "amount_paid": qty * PRICE,
    }, token=token)

    if status not in (200, 201):
        rep.bug("C", f"{code} · ring {qty} {label}".strip(),
                f"{status} {body.get('errors') or body.get('message')}")
        return None

    sale = body.get("data") or {}
    state["cash_taken"] = state.get("cash_taken", 0.0) + float(sale.get("total") or 0)
    return sale


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
