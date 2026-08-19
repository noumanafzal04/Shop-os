"""
Phase O — the two tickets that are not a sale.

Everything Phase C rang was over in one breath: items in, money out, done. The
shop's day is not made of those. It is made of a basket parked while the
customer goes back for milk, and an order shouted down a phone that a boy on a
motorbike will deliver in forty minutes. Both are a claim on stock that has not
been paid for, and each is dangerous in the opposite direction:

    A PARKED TICKET HOLDS NOTHING   it is a note, not a sale. Parking one must
                                    not move a single unit — the customer may
                                    never come back, and the shelf has to stay
                                    true for whoever walks in next.

    A PHONE ORDER HOLDS EVERYTHING  the moment it is taken, that stock is spoken
                                    for. Two orders for the last packet is a
                                    customer standing at a door for nothing, so
                                    the order takes its hold immediately and
                                    gives it back on cancel — EXACTLY once.

The parked ticket has one more edge, and it is the reason `claim` exists at all.
A ticket belongs to the SITE, not to the cashier who parked it, so any lane can
finish it. Two lanes opening the held list at the same moment could both load
the same basket and both sell it: one basket, two bills, stock off the shelf
twice. Resuming is therefore atomic — one lane gets the cart, everyone else
gets a refusal.
"""

import uuid

from api import Api, Report
from shelf import on_hand

PARKED = 3
ORDERED = 2


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code, state in sold.items():
        features = state.get("features") or {}
        token = state["token"]

        if features.get("pos"):
            _a_parked_ticket_holds_nothing(api, rep, code, token, state)
            _only_one_lane_can_resume_a_ticket(api, rep, code, token, state)
            _a_cleared_ticket_leaves_no_claim(api, rep, code, token, state)

        # `feature:products`, deliberately — a pharmacy that delivers but sells
        # nothing online has marketplace off and still takes orders by phone.
        if features.get("products"):
            _an_order_is_priced_by_the_shop(api, rep, code, token, state)
            if features.get("inventory"):
                _an_order_holds_stock_and_gives_it_back(api, rep, code, token, state,
                                                        delivers=bool(features.get("delivery")))
            _a_cancelled_order_cannot_be_completed(api, rep, code, token, state)

        if features.get("delivery"):
            _a_rider_carries_the_shop_s_own_orders(api, rep, code, token, state)

    return sold


# ── the parked ticket ──────────────────────────────────────────────────

def _a_parked_ticket_holds_nothing(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    Park a basket; the shelf must not notice.

    A held ticket is a piece of paper under the till. If parking one moved
    stock, a shop that parks ten tickets across a busy Saturday would be
    refusing to sell things it has, and no error would ever be raised — the
    count would simply be wrong all day.
    """
    pid = state["product"]["id"]
    tracks = bool(state["product"].get("track_inventory"))
    before = on_hand(api, token, pid) if tracks else None

    status, body = api.post("/pos/held", {
        "label": "Sweep · gone for milk",
        "cart": {"items": [{"product_id": pid, "quantity": PARKED}]},
        "total_estimate": 1500,
    }, token=token)

    if status not in (200, 201):
        rep.bug("O", f"{code} · park a ticket", _why(status, body))
        return

    held_id = (body.get("data") or {}).get("id")
    rep.ok("O", f"{code} · ticket parked", str(held_id)[:8])

    if tracks:
        after = on_hand(api, token, pid)
        if after != before:
            rep.bug("O", f"{code} · A PARKED TICKET HOLDS NOTHING",
                    f"parking {PARKED} moved the shelf from {before} to {after}")
        else:
            rep.ok("O", f"{code} · the shelf did not notice", f"still {after}")

    # And it must be findable again, or "park it" is "lose it".
    status, body = api.get("/pos/held", token=token)
    ids = [h.get("id") for h in _rows(body)]
    if held_id not in ids:
        rep.bug("O", f"{code} · A PARKED TICKET COMES BACK",
                f"{held_id} is not in the held list of {len(ids)}")
    else:
        rep.ok("O", f"{code} · ticket is in the held list", f"{len(ids)} parked")

    _clear(api, token, held_id)


def _only_one_lane_can_resume_a_ticket(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    Claim it twice. The second must be refused.

    This is the one that costs real goods. A ticket belongs to the site, so any
    lane can finish it — and two cashiers who open the held list in the same
    second would otherwise both load the same basket and both take money for it.
    One basket, two bills, and the stock leaves twice.
    """
    pid = state["product"]["id"]
    status, body = api.post("/pos/held", {
        "label": "Sweep · two lanes",
        "cart": {"items": [{"product_id": pid, "quantity": 1}]},
    }, token=token)
    held_id = (body.get("data") or {}).get("id")
    if status not in (200, 201) or not held_id:
        rep.bug("O", f"{code} · park a ticket to race for", _why(status, body))
        return

    first, body1 = api.post(f"/pos/held/{held_id}/claim", token=token)
    if first != 200:
        rep.bug("O", f"{code} · the first lane resumes the ticket", _why(first, body1))
        _clear(api, token, held_id)
        return

    cart = (body1.get("data") or {}).get("cart") or {}
    if not (cart.get("items") or []):
        rep.bug("O", f"{code} · RESUMING HANDS BACK THE BASKET",
                "the claim returned no items — the cashier resumes an empty till")
    else:
        rep.ok("O", f"{code} · first lane got the basket",
               f"{len(cart['items'])} line(s)")

    second, body2 = api.post(f"/pos/held/{held_id}/claim", token=token)
    error = (body2.get("meta") or {}).get("error_code")
    if second == 200:
        rep.bug("O", f"{code} · ONE BASKET CANNOT BE RESUMED TWICE",
                "a second lane claimed the same ticket — one basket, two bills")
    else:
        rep.ok("O", f"{code} · second lane refused", f"{second} {error or ''}".strip())


def _a_cleared_ticket_leaves_no_claim(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """Binning a parked ticket must remove it, and must still move no stock."""
    pid = state["product"]["id"]
    tracks = bool(state["product"].get("track_inventory"))
    before = on_hand(api, token, pid) if tracks else None

    _, body = api.post("/pos/held", {
        "label": "Sweep · customer left",
        "cart": {"items": [{"product_id": pid, "quantity": 5}]},
    }, token=token)
    held_id = (body.get("data") or {}).get("id")
    if not held_id:
        return

    status, _ = api.delete(f"/pos/held/{held_id}", token=token)
    if status not in (200, 204):
        rep.bug("O", f"{code} · bin a parked ticket", str(status))
        return

    _, body = api.get("/pos/held", token=token)
    if held_id in [h.get("id") for h in _rows(body)]:
        rep.bug("O", f"{code} · A BINNED TICKET IS GONE", f"{held_id} is still listed")
    else:
        rep.ok("O", f"{code} · binned ticket is gone")

    if tracks:
        after = on_hand(api, token, pid)
        if after != before:
            rep.bug("O", f"{code} · BINNING A TICKET MOVES NO STOCK",
                    f"shelf went {before} → {after}")
        else:
            rep.ok("O", f"{code} · binning moved no stock", f"still {after}")


# ── the phone order ────────────────────────────────────────────────────

def _an_order_is_priced_by_the_shop(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """The Phase C rule, on the other door: a caller names the item, never the price."""
    pid = state["product"]["id"]
    listed = float(state["product"].get("price") or 0)

    status, body = api.post("/orders", {
        "channel": "phone",
        "customer_name": "Sweep Caller",
        "customer_phone": "03001234567",
        "fulfillment_type": "pickup",
        "items": [{"product_id": pid, "quantity": 1, "unit_price": 1, "line_total": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, token=token)

    if status not in (200, 201):
        rep.bug("O", f"{code} · take an order by phone", _why(status, body))
        return

    order = body.get("data") or {}
    charged = float((order.get("items") or [{}])[0].get("unit_price") or 0)

    if abs(charged - listed) > 0.01:
        rep.bug("O", f"{code} · THE SHOP PRICES THE PHONE ORDER",
                f"caller said 1, shop lists {listed}, charged {charged}")
    else:
        rep.ok("O", f"{code} · caller's price ignored", f"charged {charged:.0f} not 1")

    state["order"] = order


def _an_order_holds_stock_and_gives_it_back(api: Api, rep: Report, code: str, token: str,
                                            state: dict, delivers: bool) -> None:
    """
    An order taken is stock spoken for; an order cancelled gives it back once.

    Both halves matter and they fail in opposite directions. No hold, and two
    customers are promised the last packet. No release, and the shop is short of
    goods it still has on the shelf — permanently, because nothing will ever
    tell it.
    """
    pid = state["product"]["id"]
    if not state["product"].get("track_inventory"):
        return

    before = on_hand(api, token, pid)

    # The hold is about the ORDER, not the van. A workshop and a filling
    # station take orders and hold stock against them while offering no
    # delivery at all — asking for one gets a correct 422, which the first
    # version of this check reported as a bug on two shops that were right.
    order = {
        "channel": "phone",
        "customer_name": "Sweep Order Hold",
        "customer_phone": "03007654321",
        "fulfillment_type": "delivery" if delivers else "pickup",
        "payment_method": "cod",
        "items": [{"product_id": pid, "quantity": ORDERED}],
        "idempotency_key": str(uuid.uuid4()),
    }
    if delivers:
        order["delivery_address"] = "12 Sweep Street, Lahore"

    status, body = api.post("/orders", order, token=token)

    if status not in (200, 201):
        rep.bug("O", f"{code} · take a delivery order", _why(status, body))
        return

    order_id = (body.get("data") or {}).get("id")
    held = on_hand(api, token, pid)

    if held != before - ORDERED:
        rep.bug("O", f"{code} · AN ORDER HOLDS ITS STOCK",
                f"ordering {ORDERED} left the shelf at {held}, expected {before - ORDERED} "
                f"— the next customer will be sold the same goods")
    else:
        rep.ok("O", f"{code} · order held its stock", f"{before} → {held}")

    status, body = api.post(f"/orders/{order_id}/cancel", {"reason": "Sweep"}, token=token)
    if status != 200:
        rep.bug("O", f"{code} · cancel an order", _why(status, body))
        return

    back = on_hand(api, token, pid)
    if back != before:
        rep.bug("O", f"{code} · A CANCELLED ORDER GIVES ITS STOCK BACK",
                f"shelf is {back}, was {before} before the order — "
                f"{'still holding' if back < before else 'restored twice'}")
    else:
        rep.ok("O", f"{code} · cancel released the hold", f"back to {back}")

    state["cancelled_order"] = order_id


def _a_cancelled_order_cannot_be_completed(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    The stock was already given back. Completing now would sell it a second
    time from a shelf that no longer counts it — the double-restore's twin.
    """
    order_id = state.get("cancelled_order")
    if not order_id:
        return

    status, body = api.post(f"/orders/{order_id}/advance", {"status": "completed"}, token=token)
    if status == 200:
        rep.bug("O", f"{code} · A CANCELLED ORDER STAYS CANCELLED",
                "it was advanced to completed after its stock had been returned")
    else:
        rep.ok("O", f"{code} · a cancelled order cannot be completed",
               f"{status} {(body.get('meta') or {}).get('error_code') or ''}".strip())


# ── the rider ──────────────────────────────────────────────────────────

def _a_rider_carries_the_shop_s_own_orders(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """A rider is the shop's own; an order may only be given to one of them."""
    status, body = api.post("/riders", {"name": "Sweep Rider", "phone": "03009998877"}, token=token)
    if status not in (200, 201):
        # Already there from a previous run is fine; anything else is not.
        status, body = api.get("/riders", token=token)
        rider = next((r for r in _rows(body) if r.get("name") == "Sweep Rider"), None)
        if rider is None:
            rep.bug("O", f"{code} · the shop can add a rider", _why(status, body))
            return
    else:
        rider = body.get("data") or {}

    rep.ok("O", f"{code} · rider on the books", rider.get("name"))

    status, body = api.post("/orders", {
        "channel": "whatsapp",
        "customer_name": "Sweep Rider Test",
        "customer_phone": "03005556677",
        "fulfillment_type": "delivery",
        "delivery_address": "44 Sweep Road, Lahore",
        "payment_method": "cod",
        "items": [{"product_id": state["product"]["id"], "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, token=token)
    order_id = (body.get("data") or {}).get("id")
    if status not in (200, 201) or not order_id:
        rep.bug("O", f"{code} · take an order to give a rider", _why(status, body))
        return

    status, body = api.post(f"/orders/{order_id}/assign-rider",
                            {"rider_id": rider["id"]}, token=token)
    if status != 200:
        rep.bug("O", f"{code} · give the order to a rider", _why(status, body))
    else:
        rep.ok("O", f"{code} · order assigned to {rider.get('name')}")

    # A rider who does not exist is not a rider. Handing an order to a made-up
    # id would leave a delivery nobody is carrying and nobody is chasing.
    status, _ = api.post(f"/orders/{order_id}/assign-rider",
                         {"rider_id": str(uuid.uuid4())}, token=token)
    if status in (200, 201):
        rep.bug("O", f"{code} · AN ORDER GOES TO A REAL RIDER",
                "accepted a rider id that does not exist")
    else:
        rep.ok("O", f"{code} · unknown rider refused", str(status))

    api.post(f"/orders/{order_id}/cancel", {"reason": "Sweep cleanup"}, token=token)


# ── helpers ────────────────────────────────────────────────────────────

def _clear(api: Api, token: str, held_id) -> None:
    if held_id:
        api.delete(f"/pos/held/{held_id}", token=token)


def _why(status: int, body: dict) -> str:
    return f"{status} {body.get('errors') or body.get('message')}"


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
