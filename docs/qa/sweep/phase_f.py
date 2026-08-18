"""
Phase F — the seams.

Every phase before this one exercised a module doing its own job, and every one
came back clean. That is expected: a module is written, reviewed and tested as a
unit. What nobody owns is the JOIN — the sale that outlives the product it
names, the refund that arrives after the drawer it belongs to was counted, the
module switched off while somebody is standing on its screen, and the id from
one shop offered to another shop's endpoint.

Those are the four here, and they are the four because each one is a place where
two correct pieces of code can still produce a wrong shop.

The last of them is not a correctness question but a containment one. Multi-
tenancy has exactly one catastrophic failure, and it is a shop seeing another
shop's money. It gets checked from the outside, with a real second tenant and a
real token, because the scope that protects it is invisible from inside a test
that never had two tenants in the room.
"""

from api import Api, Report
from phase_c import PRICE

BUMPED_PRICE = 4321.0


def run(api: Api, rep: Report, sold: dict, tenants: dict) -> dict:
    if not sold:
        return {}

    _one_shop_cannot_reach_another(api, rep, sold)

    for code, state in sold.items():
        token = state["token"]
        _sale_outlives_the_price(api, rep, code, token, state)
        _sale_outlives_the_product(api, rep, code, token, state)
        _refund_after_the_drawer_closed(api, rep, code, token, state)

    _module_off_takes_its_screens(api, rep, sold, tenants)

    return sold


# ── the wall between shops ─────────────────────────────────────────────

def _one_shop_cannot_reach_another(api: Api, rep: Report, sold: dict) -> None:
    """
    Two real tenants, two real tokens, and every id swapped between them.

    This is the only failure in a multi-tenant system that ends the company, so
    it is checked with the ids the sweep already made rather than with fixtures:
    a product, a sale and a customer that genuinely belong to somebody else.

    Two different right answers, and both are fine:
      404  the row is invisible — the tenant scope hid it
      422  the row failed a scoped `exists` rule
    What is NOT fine is 200.
    """
    pair = [c for c in ("retail", "mart", "pharmacy", "automotive", "petroleum") if c in sold][:2]
    if len(pair) < 2:
        rep.query("F", "two shops to test isolation with", f"only have {list(sold)}")
        return

    mine, theirs = sold[pair[0]], sold[pair[1]]
    intruder = theirs["token"]

    # 1 · read the other shop's product by id
    status, _ = api.get(f"/products/{mine['product']['id']}", token=intruder)
    _walled(rep, f"{pair[1]} cannot read {pair[0]}'s product", status)

    # 2 · read the other shop's sale by id
    sale = mine.get("stock_sale") or mine.get("priced_sale") or {}
    if sale.get("id"):
        status, _ = api.get(f"/sales/{sale['id']}", token=intruder)
        _walled(rep, f"{pair[1]} cannot read {pair[0]}'s sale", status)

    # 3 · SELL the other shop's product — the one that would move real stock
    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": mine["product"]["id"], "quantity": 1}],
        "payment_method": "cash",
        "amount_paid": PRICE,
    }, token=intruder)
    _walled(rep, f"{pair[1]} cannot SELL {pair[0]}'s product", status, loud=True)

    # 4 · refund against the other shop's sale
    if sale.get("id") and (sale.get("items") or []):
        status, _ = api.post(f"/sales/{sale['id']}/returns", {
            "items": [{"sale_item_id": sale["items"][0]["id"], "quantity": 1}],
            "refund_method": "cash",
        }, token=intruder)
        _walled(rep, f"{pair[1]} cannot refund {pair[0]}'s sale", status, loud=True)

    # 5 · close the other shop's drawer
    status, _ = api.get(f"/pos/sessions/{mine['session'].get('id')}/z-report", token=intruder)
    if status in (200, 201):
        rep.bug("F", f"{pair[1]} CAN READ {pair[0]}'s DRAWER", "z-report returned 200")
    else:
        rep.ok("F", f"{pair[1]} cannot read {pair[0]}'s drawer", str(status))


def _walled(rep: Report, what: str, status: int, loud: bool = False) -> None:
    if status in (200, 201):
        rep.bug("F", what.upper() if loud else what, "returned 200 — THE WALL IS DOWN")
    elif status in (403, 404, 422):
        rep.ok("F", what, str(status))
    else:
        rep.query("F", what, f"refused with {status} — expected 404 or 422")


# ── a record that outlives what it points at ───────────────────────────

def _sale_outlives_the_price(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    Re-price the product; the sale rung yesterday must not move.

    A receipt that changes when the shelf price changes is not a receipt. It is
    also how a return refunds the wrong amount six weeks later, and how a margin
    report quietly rewrites last month.
    """
    sale = state.get("stock_sale") or state.get("priced_sale")
    if not sale or not sale.get("id"):
        return

    before = float(sale.get("total") or 0)
    pid = state["product"]["id"]

    status, _ = api.put(f"/products/{pid}", {"price": BUMPED_PRICE}, token=token)
    if status not in (200, 201):
        rep.query("F", f"{code} · can re-price the product", str(status))
        return

    status, body = api.get(f"/sales/{sale['id']}", token=token)
    after = float((body.get("data") or {}).get("total") or 0)

    # Put it back before anything else reads it.
    api.put(f"/products/{pid}", {"price": PRICE}, token=token)

    if abs(after - before) > 0.01:
        rep.bug("F", f"{code} · A SALE IS FROZEN AT ITS OWN PRICE",
                f"was {before}, re-pricing the product made it {after}")
    else:
        rep.ok("F", f"{code} · re-pricing left the old sale alone", f"{before:.0f}")


def _sale_outlives_the_product(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    Delete the product the sale names, then read the sale back.

    `sale_items` snapshots `product_name`, `sku`, `unit_price` and `item_type`
    for exactly this reason, and `product_id` is `nullOnDelete`. A shop clears
    out last season's catalog constantly; if that blanked the history, every
    receipt, return and report older than the cleanup would be unreadable.

    The product is created fresh here rather than reusing the sweep's own, so
    deleting it destroys nothing the later phases need.
    """
    status, body = api.post("/products", {
        "item_type": state["item_type"],
        "name": "Sweep Doomed Item",
        "price": 250,
        "cost": 100,
        "tax_rate": 0,
        **({"track_inventory": True, "stock_quantity": 20} if state["item_type"] != "service" else {}),
        **({"expiry_date": "2030-12-31"} if state["item_type"] == "medicine" else {}),
    }, token=token)

    if status not in (200, 201):
        # Reuse the one from a previous run if it is still there.
        _, body = api.get("/products?search=Sweep+Doomed", token=token)
        rows = _rows(body)
        doomed = next((r for r in rows if r.get("name") == "Sweep Doomed Item"), None)
        if doomed is None:
            rep.query("F", f"{code} · a product to delete", str(status))
            return
    else:
        doomed = body.get("data") or {}

    # No `cash_session_id`: Phase C already counted that drawer out, and naming
    # a closed shift fails the `OwnOpenShift` rule — which would be the sweep
    # tripping over its own earlier phase rather than anything under test here.
    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": doomed["id"], "quantity": 1}],
        "payment_method": "cash",
        "amount_paid": 250,
    }, token=token)
    if status not in (200, 201):
        rep.bug("F", f"{code} · sell the doomed product", _why(status, body))
        return

    sale_id = (body.get("data") or {}).get("id")

    status, _ = api.delete(f"/products/{doomed['id']}", token=token)
    if status not in (200, 204):
        rep.query("F", f"{code} · delete a product", str(status))
        return

    status, body = api.get(f"/sales/{sale_id}", token=token)
    if status != 200:
        rep.bug("F", f"{code} · A DELETED PRODUCT DOES NOT ERASE THE SALE",
                f"reading the sale after the delete returned {status}")
        return

    items = (body.get("data") or {}).get("items") or []
    named = [i for i in items if (i.get("product_name") or "").strip()]

    if not items:
        rep.bug("F", f"{code} · THE SALE KEPT ITS LINES", "sale reads back with no items")
    elif not named:
        rep.bug("F", f"{code} · THE SALE STILL NAMES WHAT WAS SOLD",
                "every line lost its product_name when the product went")
    else:
        rep.ok("F", f"{code} · deleted product, sale still reads", named[0]["product_name"])

    # And it must not be sellable again.
    status, _ = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": doomed["id"], "quantity": 1}],
        "payment_method": "cash",
        "amount_paid": 250,
    }, token=token)
    if status in (200, 201):
        rep.bug("F", f"{code} · A DELETED PRODUCT CANNOT BE SOLD", "the sale was accepted")
    else:
        rep.ok("F", f"{code} · deleted product refuses to sell", str(status))


# ── money arriving after the drawer was counted ────────────────────────

def _refund_after_the_drawer_closed(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    The customer comes back after the shift was counted out.

    The shift Phase C opened has been closed, so this refund has no open drawer
    to belong to. Whatever the system does, it must not do it silently: either
    it refuses (and says why), or it accepts and attaches the refund somewhere a
    person can later find. What must never happen is a refund that lands in a
    CLOSED shift, because that shift has already been signed off and its
    variance already explained.
    """
    sale = state.get("stock_sale") or state.get("priced_sale")
    if not sale or not (sale.get("items") or []):
        return

    closed_id = state["session"].get("id")

    status, body = api.post(f"/sales/{sale['id']}/returns", {
        "items": [{"sale_item_id": sale["items"][0]["id"], "quantity": 1}],
        "reason": "QA sweep late refund",
        "refund_method": "cash",
        "cash_session_id": closed_id,
    }, token=token)

    if status in (200, 201):
        landed = (body.get("data") or {}).get("cash_session_id")
        if landed == closed_id:
            rep.bug("F", f"{code} · A REFUND CANNOT ENTER A CLOSED SHIFT",
                    f"it was attached to {closed_id}, which is already counted out")
        else:
            rep.ok("F", f"{code} · late refund kept out of the closed shift",
                   f"landed on {landed or 'no shift'}")
    elif status == 422:
        rep.ok("F", f"{code} · late refund refused", body.get("error_code") or "422")
    else:
        rep.query("F", f"{code} · refund after the drawer closed", f"{status} {body.get('message')}")


# ── a module taken away mid-session ────────────────────────────────────

def _module_off_takes_its_screens(api: Api, rep: Report, sold: dict, tenants: dict) -> None:
    """
    Switch a module off while the shop's token is still live.

    The token does not change, the session does not end, and the shop has no
    idea. Every route behind that module must start refusing immediately —
    otherwise "we removed that module" means nothing until the cashier happens
    to log out, which on a till is never.

    Restored afterwards, always: this runs against a tenant the later phases
    still need.
    """
    code = next((c for c in ("mart", "retail", "pharmacy") if c in sold), None)
    if code is None or code not in tenants:
        rep.query("F", "a tenant to switch a module off on", f"have {list(sold)}")
        return

    state = sold[code]
    token = state["token"]
    tenant_id = tenants[code]["id"]

    before = dict(state.get("features") or {})
    if not before.get("inventory"):
        rep.query("F", f"{code} · inventory was on to begin with", "cannot test the switch")
        return

    # Works before.
    status, _ = api.get("/inventory/low-stock", token=token)
    if status != 200:
        rep.query("F", f"{code} · inventory reachable before the switch", str(status))
        return

    off = {**before, "inventory": False}
    status, body = api.put(f"/admin/tenants/{tenant_id}/modules", {"modules": off})
    if status not in (200, 201):
        rep.query("F", f"{code} · switch inventory off", f"{status} {body.get('errors') or body.get('message')}")
        return

    try:
        status, _ = api.get("/inventory/low-stock", token=token)
        if status == 200:
            rep.bug("F", f"{code} · A MODULE SWITCHED OFF TAKES ITS SCREENS",
                    "inventory still answers 200 on a live token")
        else:
            rep.ok("F", f"{code} · module off closes its routes at once", str(status))

        # And the shop's own view of itself must agree — otherwise the sidebar
        # keeps drawing a screen every click of which now fails.
        status, body = api.get("/auth/me", token=token)
        live = (((body.get("data") or {}).get("tenant") or {}).get("features") or {})
        if live.get("inventory"):
            rep.bug("F", f"{code} · /auth/me AGREES THE MODULE IS GONE",
                    "it still reports inventory on")
        else:
            rep.ok("F", f"{code} · the shop is told the module went")
    finally:
        api.put(f"/admin/tenants/{tenant_id}/modules", {"modules": before})

    status, _ = api.get("/inventory/low-stock", token=token)
    if status != 200:
        rep.bug("F", f"{code} · SWITCHING IT BACK ON RESTORES IT", f"still {status}")
    else:
        rep.ok("F", f"{code} · module restored")


def _why(status: int, body: dict) -> str:
    """A refusal is only useful if it says which field. Laravel puts the reason
    in `errors` and a generic sentence in `message`; reporting only the sentence
    cost this sweep a full run to diagnose."""
    errs = body.get("errors")
    return f"{status} {errs or body.get('message')}"


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
