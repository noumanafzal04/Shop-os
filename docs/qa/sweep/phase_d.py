"""
Phase D — the shelf on its own, away from the till.

Selling is only one of the ways stock moves. Goods arrive, get counted, get
thrown away, get carried to the other branch, and get corrected by hand — and
each of those paths writes to the same number. A shop's stock figure is wrong
the moment ANY of them is wrong, and the till is not where you find out.

Two things here are worth more than the rest:

    MOVING COST   receiving at a new price re-blends what the shop thinks it
                  paid. Get this wrong and every profit figure is wrong, quietly
                  and for ever — nothing errors, the margin is just fiction.

    OVERSELL      can the shop sell what it does not have? Whatever the answer
                  is, it must be the SAME answer everywhere, and somebody must
                  have chosen it.
"""

from api import Api, Report, gated_on
from shelf import on_hand, rollup

RECEIVE_QTY = 10
RECEIVE_COST = 600.0   # deliberately not the product's 300 — see moving cost


def run(api: Api, rep: Report, sold: dict) -> dict:
    out: dict[str, dict] = {}

    for code, state in sold.items():
        token = state["token"]
        if state["item_type"] == "service":
            rep.ok("D", f"{code} · service keeps no shelf", "skipped, correctly")
            continue
        if not state.get("features", {}).get("inventory"):
            rep.ok("D", f"{code} · no inventory module", "skipped, correctly")
            continue

        pid = state["product"]["id"]
        _adjust_moves_it(api, rep, code, token, pid)
        _cannot_adjust_below_zero(api, rep, code, token, pid)
        _receive_blends_cost(api, rep, code, token, pid)
        _count_sets_the_truth(api, rep, code, token, pid, state)
        _oversell(api, rep, code, token, pid)
        _movements_name_every_path(api, rep, code, token, pid)

        out[code] = state

    return out


# ── by hand ────────────────────────────────────────────────────────────

def _adjust_moves_it(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """in / out / set — three verbs, and `set` is not `in` with subtraction."""
    before = _stock(api, token, pid)
    if before is None:
        rep.query("D", f"{code} · stock is readable", "no stock_quantity")
        return

    api.post("/inventory/adjust", {"product_id": pid, "type": "in",
                                   "quantity": 5, "reason": "QA sweep in"}, token=token)
    api.post("/inventory/adjust", {"product_id": pid, "type": "out",
                                   "quantity": 2, "reason": "QA sweep out"}, token=token)
    after = _stock(api, token, pid)

    if after is None or abs((after - before) - 3) > 0.001:
        rep.bug("D", f"{code} · ADJUST IN/OUT MOVES STOCK", f"{before} → {after}, +5 −2")
    else:
        rep.ok("D", f"{code} · adjust in 5, out 2")

    status, _ = api.post("/inventory/adjust", {"product_id": pid, "type": "set",
                                               "new_quantity": 42, "reason": "QA sweep set"}, token=token)
    exact = _stock(api, token, pid)
    if status not in (200, 201) or exact is None or abs(exact - 42) > 0.001:
        rep.bug("D", f"{code} · SET MEANS SET", f"asked for 42, shelf says {exact}")
    else:
        rep.ok("D", f"{code} · set to 42")


def _cannot_adjust_below_zero(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    Taking out more than is there.

    A shop CAN be short — a theft, a breakage nobody logged — so the honest
    answers are "refuse" or "allow and record it". What must never happen is a
    silent clamp to zero, because then the shortfall the shop needed to see
    disappears into the correction.
    """
    before = _stock(api, token, pid)
    status, body = api.post("/inventory/adjust", {
        "product_id": pid, "type": "out",
        "quantity": (before or 0) + 1000, "reason": "QA sweep oversubtract",
    }, token=token)
    after = _stock(api, token, pid)

    if status in (200, 201):
        if after is not None and abs(after) < 0.001 and before is not None:
            rep.query("D", f"{code} · adjust below zero", f"clamped {before} → 0 silently")
        else:
            rep.query("D", f"{code} · adjust below zero allowed", f"{before} → {after}")
    else:
        rep.ok("D", f"{code} · adjust below zero refused", f"{status}")
        if after is not None and before is not None and abs(after - before) > 0.001:
            rep.bug("D", f"{code} · REFUSED ADJUST CHANGED NOTHING", f"{before} → {after}")


# ── goods arriving ─────────────────────────────────────────────────────

def _receive_blends_cost(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    The quietest number in the system.

    Receiving 10 at Rs 600 into 42 already held at Rs 300 must leave the cost at
    the weighted average — not 600 (last-price), not 300 (unchanged), and never
    blank. A blanked cost turns every margin into the sale price, and a shop
    reads that as a very good month.
    """
    supplier = _supplier(api, token)
    if supplier is None:
        rep.query("D", f"{code} · can create a supplier", "none available")
        return

    # The SHELF check below is per branch; the COST blend is weighted by
    # everything the shop holds, because `products.cost` is per product. Two
    # different numbers, both called stock.
    qty_before = _stock(api, token, pid) or 0.0
    held_before = rollup(api, token, pid) or 0.0
    cost_before = _cost(api, token, pid)

    status, body = api.post("/purchase-orders", {
        "supplier_id": supplier,
        "order_date": "2026-08-18",
        "status": "ordered",
        "items": [{"product_id": pid, "quantity": RECEIVE_QTY, "unit_cost": RECEIVE_COST}],
    }, token=token)
    if status not in (200, 201):
        rep.bug("D", f"{code} · raise a purchase order", f"{status} {body.get('errors') or body.get('message')}")
        return

    po = body.get("data") or {}
    lines = po.get("items") or []
    if not lines:
        rep.bug("D", f"{code} · PO carries its lines", "no items on the response")
        return

    status, body = api.post(f"/purchase-orders/{po['id']}/receive", {
        "items": [{"id": lines[0]["id"], "quantity": RECEIVE_QTY}],
    }, token=token)
    if status not in (200, 201):
        rep.bug("D", f"{code} · receive goods", f"{status} {body.get('errors') or body.get('message')}")
        return

    qty_after = _stock(api, token, pid)
    cost_after = _cost(api, token, pid)

    if qty_after is None or abs((qty_after - qty_before) - RECEIVE_QTY) > 0.001:
        rep.bug("D", f"{code} · RECEIVING PUTS IT ON THE SHELF", f"{qty_before} → {qty_after}")
    else:
        rep.ok("D", f"{code} · received {RECEIVE_QTY}")

    if cost_before is None:
        rep.query("D", f"{code} · product carries a cost", "cost absent before receive")
        return

    want = (held_before * cost_before + RECEIVE_QTY * RECEIVE_COST) / (held_before + RECEIVE_QTY)

    if cost_after is None:
        rep.bug("D", f"{code} · RECEIVE BLANKED THE COST", f"was {cost_before}")
    elif abs(cost_after - RECEIVE_COST) < 0.01 and abs(want - RECEIVE_COST) > 0.01:
        rep.bug("D", f"{code} · COST IS LAST PRICE, NOT BLENDED",
                f"{cost_before} + {RECEIVE_QTY}@{RECEIVE_COST} → {cost_after}, expected {want:.2f}")
    elif abs(cost_after - cost_before) < 0.01 and abs(want - cost_before) > 0.01:
        rep.bug("D", f"{code} · RECEIVE DID NOT MOVE THE COST",
                f"still {cost_after}, expected {want:.2f}")
    elif abs(cost_after - want) > 0.05:
        rep.query("D", f"{code} · blended cost", f"got {cost_after}, sweep computed {want:.2f}")
    else:
        rep.ok("D", f"{code} · cost blended {cost_before:.0f} → {cost_after:.2f}")


# ── counting ───────────────────────────────────────────────────────────

def _count_sets_the_truth(api: Api, rep: Report, code: str, token: str, pid: str, state: dict) -> None:
    """A stocktake is the shelf overruling the books. Applying it must land."""
    # Abandon anything left open by a previous run, or the new one is refused.
    status, body = api.get("/inventory/counts/current", token=token)
    open_count = (body.get("data") or {}) if status == 200 else {}
    if open_count.get("id"):
        api.delete(f"/inventory/counts/{open_count['id']}", token=token)

    draw = lambda: api.post("/inventory/counts", {"scope": "all", "notes": "QA sweep"}, token=token)

    # A restaurant is not given `stocktake`. Its refusal is the check.
    if not gated_on(rep, "D", code, state, "stocktake", "a count sheet", draw):
        return

    status, body = draw()
    if status not in (200, 201):
        rep.bug("D", f"{code} · draw a count sheet", f"{status} {body.get('errors') or body.get('message')}")
        return

    count = body.get("data") or {}
    status, body = api.get(f"/inventory/counts/{count['id']}", token=token)
    lines = ((body.get("data") or {}).get("items") or (body.get("data") or {}).get("lines") or [])
    line = next((r for r in lines if r.get("product_id") == pid), None)

    if line is None:
        rep.bug("D", f"{code} · count sheet lists the product", f"{len(lines)} lines, none matched")
        api.delete(f"/inventory/counts/{count['id']}", token=token)
        return

    counted = 7
    status, body = api.post(f"/inventory/counts/{count['id']}/lines", {
        "lines": [{"item_id": line["id"], "counted_quantity": counted}],
    }, token=token)
    if status not in (200, 201):
        rep.bug("D", f"{code} · record a counted figure", f"{status} {body.get('errors') or body.get('message')}")
        return

    status, body = api.post(f"/inventory/counts/{count['id']}/apply", {"notes": "QA sweep apply"}, token=token)
    if status not in (200, 201):
        rep.bug("D", f"{code} · apply the count", f"{status} {body.get('errors') or body.get('message')}")
        return

    after = _stock(api, token, pid)
    if after is None or abs(after - counted) > 0.001:
        rep.bug("D", f"{code} · APPLIED COUNT IS THE NEW TRUTH", f"counted {counted}, shelf says {after}")
    else:
        rep.ok("D", f"{code} · count applied · shelf now {counted}")


# ── selling what is not there ──────────────────────────────────────────

def _oversell(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    Ask the till for more than the shelf holds.

    There is no universally right answer — a pharmacy must refuse, a diner
    selling a dish whose recipe is half-tracked must not — so this reports
    rather than judges. What it will not tolerate is stock going NEGATIVE with
    no error, because that is the shop finding out from a report next month.
    """
    on_hand = _stock(api, token, pid)
    if on_hand is None:
        return

    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": pid, "quantity": on_hand + 50}],
        "payment_method": "cash",
        "amount_paid": 999999,
    }, token=token)

    after = _stock(api, token, pid)

    if status in (200, 201):
        if after is not None and after < -0.001:
            rep.bug("D", f"{code} · OVERSELL WENT NEGATIVE", f"{on_hand} → {after}, no error")
        else:
            rep.query("D", f"{code} · oversell allowed", f"{on_hand} → {after}")
    else:
        rep.ok("D", f"{code} · oversell refused", f"{status} {body.get('error_code') or ''}".strip())
        if after is not None and abs(after - on_hand) > 0.001:
            rep.bug("D", f"{code} · REFUSED SALE TOOK STOCK", f"{on_hand} → {after}")


def _movements_name_every_path(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    Every way stock moved should be traceable to WHAT moved it.

    `type` is only ever `in`, `out` or `set` — deliberately, because those are
    the three things that can happen to a number. The cause lives in
    `reference_type`, and that split is what makes the ledger usable: a sale, a
    goods-receive and a hand adjustment are all `out`/`in`, and telling them
    apart during a dispute is the ONLY time this table is ever read.

    So the check is not "are there movements" — it is "can you tell a sale from
    somebody typing a number". A ledger of thirty rows that all look identical
    is a ledger that answers nothing.
    """
    status, body = api.get(f"/inventory/movements?product_id={pid}&per_page=100", token=token)
    if status != 200:
        rep.bug("D", f"{code} · movement history", f"{status}")
        return

    rows = _rows(body)
    if not rows:
        rep.bug("D", f"{code} · movements were recorded",
                "empty after a sale, a receive and a count")
        return

    causes = {r.get("reference_type") for r in rows if r.get("reference_type")}
    rep.ok("D", f"{code} · {len(rows)} movements", ", ".join(sorted(causes)) or "no reference_type at all")

    # The sale is the one that must be there. A shop reconciling a shortfall
    # starts by asking "was it sold?", and a ledger that cannot answer that
    # sends them to the CCTV instead.
    if not any("sale" in (c or "").lower() for c in causes):
        rep.bug("D", f"{code} · A SALE LEAVES A TRACEABLE MOVEMENT",
                f"nothing references a sale; causes seen: {sorted(causes) or 'none'}")

    unattributed = [r for r in rows if not (r.get("reason") or r.get("reference_type") or r.get("notes"))]
    if unattributed:
        rep.query("D", f"{code} · every movement names its cause",
                  f"{len(unattributed)} of {len(rows)} carry neither reason nor reference")


# ── plumbing ───────────────────────────────────────────────────────────

def _supplier(api: Api, token: str) -> str | None:
    status, body = api.get("/suppliers?search=Sweep+Supplier", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((r for r in rows if r.get("name") == "Sweep Supplier"), None)
    if found:
        return found["id"]

    status, body = api.post("/suppliers", {"name": "Sweep Supplier", "phone": "03001234567"}, token=token)
    return (body.get("data") or {}).get("id") if status in (200, 201) else None


def _product(api: Api, token: str, pid: str) -> dict:
    status, body = api.get(f"/products/{pid}", token=token)
    return (body.get("data") or {}) if status == 200 else {}


def _stock(api: Api, token: str, pid: str) -> float | None:
    """The branch being operated, not the across-branches rollup."""
    return on_hand(api, token, pid)


def _cost(api: Api, token: str, pid: str) -> float | None:
    c = _product(api, token, pid).get("cost")
    return None if c is None else float(c)


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
