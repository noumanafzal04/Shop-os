"""
Phase N — the sales that are not a sale yet, and the ones that go backwards.

Phase C rang a bill and took the money. Everything here is a shape where those
two moments come APART, and every one of them is a place a shop can lose goods
or bank money twice:

    LAYAWAY    the customer pays over weeks and takes nothing home. The shop is
               holding cash against goods it still owns — real money in the
               drawer, no sale in the books.
    EXCHANGE   goods out and goods in at once. It is a return and a sale bolted
               together, and the danger is doing one half.
    TRADE-IN   the dead battery handed over the counter. It is a TENDER, not a
               discount — the difference decides whether the scrap enters stock
               and whether the bill's revenue is understated for ever.
    DISPOSAL   what left the shelf without being sold. Written off and returned
               to the supplier are two different fates and must never be summed:
               one is a loss, the other is a debt somebody owes you.
"""

import uuid

from api import Api, Report
from phase_c import PRICE

DEPOSIT = 400.0


def run(api: Api, rep: Report, sold: dict) -> dict:
    # Gate on the till, not on a list of trades — see phase K. A layaway is a
    # shape of SALE, so every shop that can ring one can get it wrong; the two
    # checks that need goods to move stay fenced behind `inventory` below.
    for code, state in sold.items():
        if not (state.get("features") or {}).get("pos"):
            continue

        token = state["token"]
        _a_layaway_holds_money_not_revenue(api, rep, code, token, state)
        _an_exchange_does_both_halves(api, rep, code, token, state)
        if (state.get("features") or {}).get("inventory"):
            _a_trade_in_is_a_tender(api, rep, code, token, state)
            _two_fates_are_never_summed(api, rep, code, token)

        # Close what this phase opened. A drawer left open is inherited by the
        # NEXT run's phase C, which opens its shift expecting a fresh float and
        # instead finds this phase's takings still in it — reported as phase C
        # failing its own drawer arithmetic, three phases from the cause.
        _close_drawer(api, token)

    return sold


# ── layaway ────────────────────────────────────────────────────────────

def _a_layaway_holds_money_not_revenue(api: Api, rep: Report, code: str,
                                       token: str, state: dict) -> None:
    """
    Money in the drawer against goods the shop still owns.

    A deposit is REAL cash the moment it is handed over — the drawer must know,
    or the shift closes over by exactly the advance every time. But it is not
    revenue: nothing has been sold, and counting it as takings overstates the
    month and then double-counts it when the customer finally collects.

    Both halves are checked, because getting either one right alone is the bug.
    """
    _open_drawer(api, token)
    before_cash = _expected(api, token)
    before_revenue = float(_totals(api, token).get("revenue") or 0)

    # The deposit rides the CREATE. A shop can insist on a minimum down
    # payment ("this shop asks for at least 20% down"), and opening a layaway
    # with nothing on it would be a promise with no commitment behind it —
    # goods held off the shelf for a customer who has risked nothing.
    status, body = api.post("/sale-documents", {
        "kind": "layaway",
        "customer_name": "Sweep Layaway",
        "customer_phone": "03004443322",
        "items": [{"product_id": state["product"]["id"], "quantity": 2}],
        "deposit": {"amount": DEPOSIT, "method": "cash"},
    }, token=token)

    if status not in (200, 201):
        rep.bug("N", f"{code} · start a layaway", _why(status, body))
        return

    doc = body.get("data") or {}
    rep.ok("N", f"{code} · layaway opened with its down payment",
           doc.get("number") or str(doc.get("id", ""))[:8])

    after_cash = _expected(api, token)
    after_revenue = float(_totals(api, token).get("revenue") or 0)

    if before_cash is None or after_cash is None:
        rep.query("N", f"{code} · the drawer figure", f"{before_cash} → {after_cash}")
    elif abs((after_cash - before_cash) - DEPOSIT) > 0.01:
        rep.bug("N", f"{code} · AN ADVANCE IS CASH IN THE DRAWER",
                f"took {DEPOSIT:.0f}, drawer moved {after_cash - before_cash:+.2f} — "
                "the shift will close over by exactly the advance")
    else:
        rep.ok("N", f"{code} · advance reached the drawer", f"+{DEPOSIT:.0f}")

    if abs(after_revenue - before_revenue) > 0.01:
        rep.bug("N", f"{code} · AN ADVANCE IS NOT REVENUE YET",
                f"revenue moved {after_revenue - before_revenue:+.2f} on a deposit — "
                "nothing has been sold, and it will be counted again on collection")
    else:
        rep.ok("N", f"{code} · advance is not revenue", f"{after_revenue:.0f} unchanged")

    # Collection: the balance is paid and NOW it becomes a sale.
    status, body = api.post(f"/sale-documents/{doc['id']}/convert", {
        "payment_method": "cash", "amount_paid": 2 * PRICE - DEPOSIT,
    }, token=token)

    if status not in (200, 201):
        rep.bug("N", f"{code} · collect the layaway", _why(status, body))
        return

    collected = float(_totals(api, token).get("revenue") or 0)
    earned = collected - after_revenue

    if abs(earned - 2 * PRICE) > 0.01:
        rep.query("N", f"{code} · what the collection booked",
                  f"the goods were {2 * PRICE:.0f}, revenue moved {earned:+.2f}")
    else:
        rep.ok("N", f"{code} · collection booked the whole sale", f"{earned:.0f}")

    # And it cannot be collected twice.
    status, _ = api.post(f"/sale-documents/{doc['id']}/convert", {
        "payment_method": "cash", "amount_paid": 2 * PRICE,
    }, token=token)
    if status in (200, 201):
        rep.bug("N", f"{code} · A LAYAWAY IS COLLECTED ONCE",
                "the same document converted to a second sale")
    else:
        rep.ok("N", f"{code} · second collection refused", str(status))


# ── exchange ───────────────────────────────────────────────────────────

def _an_exchange_does_both_halves(api: Api, rep: Report, code: str,
                                  token: str, state: dict) -> None:
    """
    Goods out and goods in, in one movement.

    An exchange is a return and a sale bolted together, and the failure is doing
    one half: the customer walks out with the new item and the old one never
    comes back onto the shelf, or the reverse. Checked on the SHELF, because
    that is the half a receipt cannot lie about.
    """
    sale = _ring(api, rep, code, token, state, qty=2)
    if sale is None:
        return

    items = sale.get("items") or []
    if not items:
        return

    before = _stock(api, token, state["product"]["id"])
    if before is None:
        return

    status, body = api.post(f"/sales/{sale['id']}/exchange", {
        "return_items": [{"sale_item_id": items[0]["id"], "quantity": 1}],
        "items": [{"product_id": state["product"]["id"], "quantity": 1}],
        "payment_method": "cash", "amount_paid": 0,
    }, token=token)

    if status not in (200, 201):
        rep.bug("N", f"{code} · exchange one for one", _why(status, body))
        return

    after = _stock(api, token, state["product"]["id"])
    if after is None:
        return

    # One back, one out — the shelf ends where it started.
    if abs(after - before) > 0.001:
        rep.bug("N", f"{code} · AN EXCHANGE DOES BOTH HALVES",
                f"one returned and one taken should leave the shelf at {before:.0f}, "
                f"it reads {after:.0f} — one half of the exchange did not happen")
    else:
        rep.ok("N", f"{code} · like-for-like exchange left the shelf level", f"{after:.0f}")


# ── trade-in ───────────────────────────────────────────────────────────

def _a_trade_in_is_a_tender(api: Api, rep: Report, code: str,
                            token: str, state: dict) -> None:
    """
    The dead battery handed across the counter.

    It is a TENDER, not a discount, and the distinction is the whole point:
    a discount would understate what the shop sold, for ever, on every report.
    As a tender the bill keeps its full value and the allowance is one of the
    ways it was paid.

    Note what the API does NOT accept: a trade-in AMOUNT. It takes a quantity
    and a unit allowance and multiplies them server-side — `trade_in` is not an
    accepted payment method either. A client that could name its own trade-in
    figure could settle any bill with nothing changing hands.
    """
    scrap = _scrap_product(api, token)
    if scrap is None:
        rep.query("N", f"{code} · something to take in part-exchange", "could not create it")
        return

    allowance = 150.0
    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": state["product"]["id"], "quantity": 1}],
        "trade_ins": [{"product_id": scrap["id"], "quantity": 1,
                       "unit_allowance": allowance, "description": "Old unit"}],
        "payment_method": "cash", "amount_paid": PRICE - allowance,
    }, token=token)

    if status not in (200, 201):
        rep.bug("N", f"{code} · take goods in part-payment", _why(status, body))
        return

    sale = body.get("data") or {}
    total = float(sale.get("total") or 0)
    discount = float(sale.get("discount") or 0)

    if abs(discount - allowance) < 0.01:
        rep.bug("N", f"{code} · A TRADE-IN IS A TENDER, NOT A DISCOUNT",
                f"the {allowance:.0f} allowance was booked as a discount — "
                "every margin and revenue figure now understates what was sold")
    elif abs(total - PRICE) > 0.01:
        rep.bug("N", f"{code} · A TRADED BILL KEEPS ITS FULL VALUE",
                f"a {PRICE:.0f} item with {allowance:.0f} taken in part-exchange "
                f"was booked at {total:.0f}")
    else:
        rep.ok("N", f"{code} · trade-in is a tender", f"bill still {total:.0f}")

    # `trade_in` must not be nameable as a payment method.
    status, _ = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": state["product"]["id"], "quantity": 1}],
        "payment_method": "trade_in", "amount_paid": PRICE,
    }, token=token)
    if status in (200, 201):
        rep.bug("N", f"{code} · TRADE-IN IS NOT A PAYMENT METHOD",
                "a bill was settled by naming trade_in as the tender")
    else:
        rep.ok("N", f"{code} · trade_in refused as a tender", str(status))


# ── disposals ──────────────────────────────────────────────────────────

def _two_fates_are_never_summed(api: Api, rep: Report, code: str, token: str) -> None:
    """
    What left the shelf without being sold.

    Written off and returned to the supplier wear the same shape and are not the
    same event. One is a loss the shop has already taken; the other is a debt a
    distributor owes. Sum them into "wastage" and an owner is told they lost
    money they are actually owed — and nobody chases a figure that has already
    been written off.

    The register is a plain list, so the separation is not a totals block to
    read: it is the `awaiting_credit` filter. That is the screen a shop works
    from — "what have I sent back that nobody has paid me for" — and it is the
    only place the distinction does any work.
    """
    product = _any_product(api, token)
    if product is None:
        return

    # Sending goods back names the supplier, and must: a claim against nobody
    # is not a claim, and the awaiting-credit list is a list of who owes you.
    supplier = _supplier(api, token)
    binned = _dispose(api, rep, code, token, product, "written_off", credit=None)
    sent = _dispose(api, rep, code, token, product, "returned_to_supplier",
                    credit=250.0, supplier=supplier)
    if binned is None or sent is None:
        return

    status, body = api.get("/inventory/disposals?awaiting_credit=1", token=token)
    if status != 200:
        rep.bug("N", f"{code} · the claims list", str(status))
        return

    owed = {r.get("id") for r in _rows(body)}

    if binned["id"] in owed:
        rep.bug("N", f"{code} · A WRITE-OFF IS NOT A CLAIM",
                "stock thrown in the bin is on the list of what a supplier owes for")
    elif sent["id"] not in owed:
        rep.bug("N", f"{code} · GOODS SENT BACK ARE A CLAIM",
                "a return to the supplier is missing from the awaiting-credit list — "
                "nobody will chase it")
    else:
        rep.ok("N", f"{code} · the bin and the claim stay apart",
               "written-off absent, returned present")

    # Crediting settles it, and it leaves the list.
    # `credit_received` and the DATE it arrived — not an "amount". A claim is
    # settled by what the distributor actually paid and when, which is what
    # makes it reconcilable against a bank line months later. "Amount" would
    # have let the expected figure be quietly restated as the received one.
    status, body = api.post(f"/inventory/disposals/{sent['id']}/credit", {
        "credit_received": 250.0,
        "credit_received_at": _today(api),
    }, token=token)
    if status not in (200, 201):
        rep.query("N", f"{code} · record the supplier's credit", _why(status, body))
        return

    status, body = api.get("/inventory/disposals?awaiting_credit=1", token=token)
    still = {r.get("id") for r in _rows(body)} if status == 200 else set()

    if sent["id"] in still:
        rep.bug("N", f"{code} · A CREDITED CLAIM LEAVES THE LIST",
                "it was paid and is still being chased")
    else:
        rep.ok("N", f"{code} · credited claim cleared")


def _dispose(api: Api, rep: Report, code: str, token: str, product: dict,
             disposition: str, credit: float | None,
             supplier: str | None = None) -> dict | None:
    """
    A lot on the shelf, then off it — and the shelf must move exactly once.

    Disposing goes through the same inventory write-path as everything else, so
    the danger is the opposite of forgetting: taking the stock off twice, once
    for the lot and once for the rollup.
    """
    number = f"SWEEP-DISP-{uuid.uuid4().hex[:6].upper()}"
    status, body = api.post(f"/inventory/products/{product['id']}/batches", {
        "batch_number": number, "quantity": 4, "cost": 100,
        "expiry_date": "2030-06-30",
    }, token=token)
    if status not in (200, 201):
        rep.query("N", f"{code} · a lot to dispose of", _why(status, body))
        return None

    batch = body.get("data") or {}
    before = _stock(api, token, product["id"])

    payload = {"quantity": 4, "disposition": disposition, "reason": "damaged",
               "notes": "QA sweep disposal"}
    if credit is not None:
        payload["credit_expected"] = credit
    if supplier is not None:
        payload["supplier_id"] = supplier

    status, body = api.call("DELETE", f"/inventory/batches/{batch['id']}", payload, token=token)

    if status not in (200, 201, 204):
        rep.bug("N", f"{code} · dispose of a lot ({disposition})", _why(status, body))
        return None

    after = _stock(api, token, product["id"])
    if before is not None and after is not None and abs((before - after) - 4) > 0.001:
        rep.bug("N", f"{code} · DISPOSING TAKES THE STOCK OFF ONCE",
                f"a lot of 4 was disposed and the shelf went {before:.0f} → {after:.0f}")
    else:
        rep.ok("N", f"{code} · {disposition.replace('_', ' ')} · 4 off the shelf")

    return (body.get("data") or {}) or {"id": None}


def _supplier(api: Api, token: str) -> str | None:
    status, body = api.get("/suppliers?search=Sweep+Supplier", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((r for r in rows if r.get("name") == "Sweep Supplier"), None)
    if found:
        return found["id"]
    status, body = api.post("/suppliers", {"name": "Sweep Supplier"}, token=token)
    return (body.get("data") or {}).get("id") if status in (200, 201) else None


def _any_product(api: Api, token: str) -> dict | None:
    status, body = api.get("/products?search=Sweep+Item", token=token)
    rows = _rows(body) if status == 200 else []
    return rows[0] if rows else None


# ── plumbing ───────────────────────────────────────────────────────────

def _scrap_product(api: Api, token: str) -> dict | None:
    name = "Sweep Trade-In Scrap"
    status, body = api.get(f"/products?search={name.replace(' ', '+')}", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((p for p in rows if p.get("name") == name), None)
    if found:
        return found
    status, body = api.post("/products", {
        "item_type": "physical_product", "name": name, "price": 200, "cost": 100,
        "tax_rate": 0, "track_inventory": True, "stock_quantity": 0,
    }, token=token)
    return (body.get("data") or {}) if status in (200, 201) else None


def _ring(api: Api, rep: Report, code: str, token: str, state: dict, qty: float) -> dict | None:
    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": state["product"]["id"], "quantity": qty}],
        "payment_method": "cash", "amount_paid": qty * PRICE,
    }, token=token)
    if status not in (200, 201):
        rep.bug("N", f"{code} · ring {qty} to exchange", _why(status, body))
        return None
    return body.get("data") or {}


def _open_drawer(api: Api, token: str) -> None:
    status, body = api.get("/pos/session", token=token)
    live = (body.get("data") or {}) if status == 200 else {}
    if live.get("status") != "open":
        api.post("/pos/session/open", {"opening_float": 3000}, token=token)


def _close_drawer(api: Api, token: str) -> None:
    status, body = api.get("/pos/session/report", token=token)
    if status != 200:
        return
    expected = ((body.get("data") or {}).get("drawer") or {}).get("expected_cash")
    api.post("/pos/session/close", {"counted_cash": max(float(expected or 0), 0)}, token=token)


def _today(api: Api) -> str:
    status, body = api.get("/health")
    return (((body.get("data") or {}).get("time") if status == 200 else None)
            or "2026-08-18T00:00:00+00:00")[:10]


def _expected(api: Api, token: str) -> float | None:
    status, body = api.get("/pos/session/report", token=token)
    if status != 200:
        return None
    v = ((body.get("data") or {}).get("drawer") or {}).get("expected_cash")
    return None if v is None else float(v)


def _totals(api: Api, token: str) -> dict:
    status, body = api.get("/reports/summary?period=daily", token=token)
    return ((body.get("data") or {}).get("totals") or {}) if status == 200 else {}


def _stock(api: Api, token: str, pid: str) -> float | None:
    from shelf import on_hand
    return on_hand(api, token, pid)


def _why(status: int, body: dict) -> str:
    return f"{status} {body.get('errors') or body.get('message')}"


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    if isinstance(raw, list):
        return raw
    for key in ("data", "items", "rows"):
        if isinstance(raw.get(key), list):
            return raw[key]
    return []
