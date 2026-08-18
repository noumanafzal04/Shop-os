"""
Phase J — the Expense Manager, and the wire between it and the drawer.

Phase E proved an expense reaches the books. That is the easy half. The hard
half is that a shop's money moves through TWO places at once — the ledger and
the physical till — and an entry that lands in one and not the other produces a
cashier who is short at ten at night with nothing to point at.

The rule underneath everything here:

    CASH IS CASH, WHEREVER IT LEAVES FROM.

A Rs 3,500 delivery paid out of the till is Rs 3,500 less in the drawer whether
it was typed into the Expenses screen, the Suppliers screen, or nowhere at all.
The drawer does not care which screen it was. It only knows what is in it.

The other half is the opposite mistake — counting the same rupee twice:

    BUYING STOCK IS NOT AN OPERATING EXPENSE.

Goods bought for resale are cost of goods sold, and they hit the profit line
when the goods are SOLD, not when they are paid for. Post the purchase as an
expense as well and the shop's costs appear twice — once in COGS, once in
expenses — and every margin it reads is wrong in the safe-looking direction.
"""

from api import Api, Report
from phase_c import PRICE

BILL = 3500.0
RENT = 12000.0
SCRAP = 900.0
SUPPLIER_PAID = 2500.0
STOCK_QTY = 8
STOCK_COST = 450.0


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code, state in sold.items():
        feats = state.get("features") or {}
        if not (feats.get("expenses") and feats.get("pos")):
            rep.ok("J", f"{code} · no expense module or no till", "skipped, correctly")
            continue

        token = state["token"]
        session = _open_drawer(api, rep, code, token)
        if session is None:
            continue

        _cash_bill_leaves_the_drawer(api, rep, code, token)
        _bank_bill_does_not(api, rep, code, token)
        _income_in_cash_lands_in_it(api, rep, code, token)
        _paying_a_supplier_leaves_it_too(api, rep, code, token, feats)
        _buying_stock_is_not_an_expense(api, rep, code, token, feats)
        _a_ceiling_warns_it_does_not_refuse(api, rep, code, token)
        _a_template_posts_a_real_bill(api, rep, code, token)
        _the_drawer_still_adds_up(api, rep, code, token)

        # Last, because it closes the drawer to prove the fence.
        _close(api, token)
        _a_shift_can_be_made_compulsory(api, rep, code, token, state)

    return sold


# ── the wire ───────────────────────────────────────────────────────────

def _cash_bill_leaves_the_drawer(api: Api, rep: Report, code: str, token: str) -> None:
    """
    A cash bill filed at the counter takes the cash with it.

    Three things must all happen, and any one of them alone is a bug:
    the expense is recorded, an `expense_out` movement appears on the shift, and
    the expense knows which movement it was — without that last link the entry
    can never be corrected without the drawer disagreeing.
    """
    before = _expected(api, token)
    cat = _category(api, token, "expense-categories", "Sweep Utilities")

    status, body = api.post("/expenses", {
        "expense_category_id": cat,
        "description": "QA sweep electricity bill",
        "amount": BILL,
        "expense_date": _today(api),
        "payment_method": "cash",
    }, token=token)

    if status not in (200, 201):
        rep.bug("J", f"{code} · file a cash bill", _why(status, body))
        return

    expense = body.get("data") or {}
    after = _expected(api, token)

    if expense.get("cash_movement_id") is None:
        rep.bug("J", f"{code} · A CASH BILL KNOWS WHICH DRAWER PAID IT",
                "no cash_movement_id — the entry and the till can drift apart for ever")
    else:
        rep.ok("J", f"{code} · cash bill linked to its movement")

    kinds = _movement_types(api, token)
    if "expense_out" not in kinds:
        rep.bug("J", f"{code} · A CASH BILL SHOWS ON THE SHIFT",
                f"no expense_out movement; saw {sorted(kinds)}")
    else:
        rep.ok("J", f"{code} · expense_out on the shift")

    _moved(rep, code, "cash bill leaves the drawer", before, after, -BILL)


def _bank_bill_does_not(api: Api, rep: Report, code: str, token: str) -> None:
    """
    The rent paid by transfer never passed through the till.

    The inverse error is just as expensive: a drawer docked for money that was
    never in it leaves the cashier short by the rent every month.
    """
    before = _expected(api, token)
    cat = _category(api, token, "expense-categories", "Sweep Rent")

    status, body = api.post("/expenses", {
        "expense_category_id": cat,
        "description": "QA sweep rent by transfer",
        "amount": RENT,
        "expense_date": _today(api),
        "payment_method": "bank_transfer",
    }, token=token)

    if status not in (200, 201):
        rep.bug("J", f"{code} · file a bank bill", _why(status, body))
        return

    if (body.get("data") or {}).get("cash_movement_id") is not None:
        rep.bug("J", f"{code} · A TRANSFER NEVER TOUCHES THE TILL",
                "a bank_transfer expense was linked to a cash movement")
        return

    after = _expected(api, token)
    _moved(rep, code, "transfer leaves the drawer alone", before, after, 0.0)


def _income_in_cash_lands_in_it(api: Api, rep: Report, code: str, token: str) -> None:
    """Scrap sold over the counter is in the till from the moment it is handed over."""
    before = _expected(api, token)
    cat = _category(api, token, "income-categories", "Sweep Scrap")

    status, body = api.post("/incomes", {
        "income_category_id": cat,
        "description": "QA sweep scrap sold",
        "amount": SCRAP,
        "income_date": _today(api),
        "payment_method": "cash",
    }, token=token)

    if status not in (200, 201):
        rep.bug("J", f"{code} · record cash income", _why(status, body))
        return

    after = _expected(api, token)
    kinds = _movement_types(api, token)

    if "income_in" not in kinds:
        rep.bug("J", f"{code} · CASH INCOME SHOWS ON THE SHIFT",
                f"no income_in movement; the drawer reads it as an overage. saw {sorted(kinds)}")
    else:
        rep.ok("J", f"{code} · income_in on the shift")

    _moved(rep, code, "cash income lands in the drawer", before, after, SCRAP)


def _paying_a_supplier_leaves_it_too(api: Api, rep: Report, code: str,
                                     token: str, feats: dict) -> None:
    """
    A separate purchase — the delivery man paid at the door.

    Nothing about this goes through the Expenses screen, and the drawer must
    still know. Before it did, a Rs 3,500 delivery paid in cash read as a
    Rs 3,500 shortage against the cashier at close.
    """
    if not feats.get("inventory"):
        rep.ok("J", f"{code} · no purchasing module", "skipped, correctly")
        return

    supplier = _supplier(api, token)
    if supplier is None:
        rep.query("J", f"{code} · a supplier to pay", "none")
        return

    before = _expected(api, token)
    status, body = api.post(f"/suppliers/{supplier}/payments", {
        "amount": SUPPLIER_PAID, "method": "cash", "notes": "QA sweep supplier paid at the door",
    }, token=token)

    if status not in (200, 201):
        rep.bug("J", f"{code} · pay a supplier in cash", _why(status, body))
        return

    after = _expected(api, token)
    kinds = _movement_types(api, token)

    if "supplier_out" not in kinds:
        rep.bug("J", f"{code} · PAYING A SUPPLIER SHOWS ON THE SHIFT",
                f"no supplier_out movement; saw {sorted(kinds)}")
    else:
        rep.ok("J", f"{code} · supplier_out on the shift")

    _moved(rep, code, "supplier paid in cash leaves the drawer", before, after, -SUPPLIER_PAID)


def _buying_stock_is_not_an_expense(api: Api, rep: Report, code: str,
                                    token: str, feats: dict) -> None:
    """
    The double count.

    Goods bought for resale are COGS — they hit the profit line when the goods
    are sold, not when they are paid for. If receiving a purchase order ALSO
    posts an operating expense, every cost is counted twice and every margin the
    shop reads is wrong in the direction that looks safe.
    """
    if not feats.get("inventory"):
        return

    supplier = _supplier(api, token)
    product = _any_product(api, token)
    if supplier is None or product is None:
        return

    before = float(_totals(api, token).get("expenses") or 0)

    status, body = api.post("/purchase-orders", {
        "supplier_id": supplier, "order_date": _today(api), "status": "ordered",
        "items": [{"product_id": product, "quantity": STOCK_QTY, "unit_cost": STOCK_COST}],
    }, token=token)
    if status not in (200, 201):
        rep.query("J", f"{code} · raise a purchase order", _why(status, body))
        return

    po = body.get("data") or {}
    lines = po.get("items") or []
    if not lines:
        return

    status, _ = api.post(f"/purchase-orders/{po['id']}/receive",
                         {"items": [{"id": lines[0]["id"], "quantity": STOCK_QTY}]}, token=token)
    if status not in (200, 201):
        rep.query("J", f"{code} · receive the goods", str(status))
        return

    after = float(_totals(api, token).get("expenses") or 0)
    value = STOCK_QTY * STOCK_COST

    if abs(after - before - value) < 0.01:
        rep.bug("J", f"{code} · BUYING STOCK IS NOT AN OPERATING EXPENSE",
                f"receiving {STOCK_QTY} @ {STOCK_COST:.0f} added {value:.0f} to expenses — "
                "it is already COGS, so every cost is now counted twice")
    elif abs(after - before) > 0.01:
        rep.query("J", f"{code} · receiving goods moved expenses",
                  f"{before:.2f} → {after:.2f} against a purchase of {value:.0f}")
    else:
        rep.ok("J", f"{code} · stock bought is COGS, not an expense", f"expenses still {after:.0f}")


# ── the ceiling and the template ───────────────────────────────────────

def _a_ceiling_warns_it_does_not_refuse(api: Api, rep: Report, code: str, token: str) -> None:
    """
    A budget is a ceiling, not a lock.

    Refusing the entry does not unspend the money — it only means the books stop
    matching the world, which is worse than the overspend. So the ceiling is
    reported back as a warning at the one moment anybody can still act on it.
    """
    cat = _category(api, token, "expense-categories", "Sweep Tea")

    status, body = api.post("/expenses/budgets",
                            {"expense_category_id": cat, "amount": 100}, token=token)
    if status not in (200, 201):
        rep.query("J", f"{code} · set a category ceiling", _why(status, body))
        return

    status, body = api.post("/expenses", {
        "expense_category_id": cat,
        "description": "QA sweep tea, well over budget",
        "amount": 5000,
        "expense_date": _today(api),
        "payment_method": "bank_transfer",
    }, token=token)

    if status not in (200, 201):
        rep.bug("J", f"{code} · A CEILING WARNS, IT DOES NOT REFUSE",
                f"an over-budget expense was rejected with {status} — the money was still spent")
        return

    warnings = ((body.get("meta") or {}).get("warnings")) or []
    if not any("budget" in w.lower() for w in warnings):
        rep.bug("J", f"{code} · GOING OVER BUDGET IS SAID OUT LOUD",
                f"recorded silently; warnings: {warnings}")
    else:
        rep.ok("J", f"{code} · over budget, recorded and warned")


def _a_template_posts_a_real_bill(api: Api, rep: Report, code: str, token: str) -> None:
    """
    A recurring bill that never posts itself is a reminder, not a feature.

    The template falling DUE is the whole product — a shop that has to remember
    to press the button has gained nothing over a note on the wall.
    """
    cat = _category(api, token, "expense-categories", "Sweep Internet")

    status, body = api.get("/expenses/recurring", token=token)
    rows = _rows(body) if status == 200 else []
    template = next((r for r in rows if r.get("description") == "QA sweep internet"), None)

    if template is None:
        status, body = api.post("/expenses/recurring", {
            "expense_category_id": cat,
            "description": "QA sweep internet",
            "amount": 4000,
            "frequency": "monthly",
            "next_due_on": _today(api),
            "payment_method": "bank_transfer",
        }, token=token)
        if status not in (200, 201):
            rep.bug("J", f"{code} · set up a recurring bill", _why(status, body))
            return
        template = body.get("data") or {}

    # Wind it back to today first. A template posted on a previous run has
    # correctly moved itself a month forward and refuses ("isn't due until
    # Sep 18") — which is the feature working, and a sweep that can only
    # exercise it once is a sweep that stops testing it after the first day.
    today = _today(api)
    api.put(f"/expenses/recurring/{template['id']}", {"next_due_on": today}, token=token)

    due_before = today

    status, body = api.post(f"/expenses/recurring/{template['id']}/post", {}, token=token)
    if status not in (200, 201):
        rep.bug("J", f"{code} · a template posts a real bill", _why(status, body))
        return

    rep.ok("J", f"{code} · recurring bill posted")

    status, body = api.get("/expenses/recurring", token=token)
    rows = _rows(body) if status == 200 else []
    after = next((r for r in rows if r.get("id") == template["id"]), {})
    due_after = after.get("next_due_on")

    if due_before and due_after and str(due_after)[:10] == str(due_before)[:10]:
        rep.bug("J", f"{code} · POSTING MOVES THE DUE DATE ON",
                f"still due {due_after} — it would post again, every day, for ever")
    else:
        rep.ok("J", f"{code} · due date moved on", f"{str(due_before)[:10]} → {str(due_after)[:10]}")

    # And it must refuse to post again until it comes round.
    status, body = api.post(f"/expenses/recurring/{template['id']}/post", {}, token=token)
    if status in (200, 201):
        rep.bug("J", f"{code} · A TEMPLATE POSTS ONCE PER PERIOD",
                "the same monthly bill posted twice in one run")
    else:
        rep.ok("J", f"{code} · will not post again until due", str(status))


def _the_drawer_still_adds_up(api: Api, rep: Report, code: str, token: str) -> None:
    """
    After all of that: does the till's own figure still equal its own parts?

    The drawer publishes both — the components (`cash_tendered`, `change_given`,
    `cash_refunds`, `tips`, `cash_in`, `cash_out`) and the total the cashier is
    counted against. Checking one against the other catches a movement recorded
    but not counted, or counted twice, without the sweep having to know what
    happened first:

        expected = opening + tendered − change − refunds + tips + in − out

    `opening_float` is on the SESSION, not the drawer. Reading it off the drawer
    gave zero, and the check then failed by exactly the float — a difference
    that looks like a missing five thousand rupees and is a missing key.
    """
    status, body = api.get("/pos/session/report", token=token)
    if status != 200:
        rep.bug("J", f"{code} · read the drawer", str(status))
        return

    d = body.get("data") or {}
    drawer = d.get("drawer") or {}
    expected = drawer.get("expected_cash")
    if expected is None:
        rep.ok("J", f"{code} · blind close hides the figure")
        return

    opening = float((d.get("session") or {}).get("opening_float") or 0)
    part = lambda k: float(drawer.get(k) or 0)  # noqa: E731

    want = (opening
            + part("cash_tendered") - part("change_given") - part("cash_refunds")
            + part("tips") + part("cash_in") - part("cash_out"))

    if abs(float(expected) - want) > 0.01:
        rep.bug("J", f"{code} · THE DRAWER EQUALS ITS OWN PARTS",
                f"float {opening:.0f} + tendered {part('cash_tendered'):.0f} "
                f"− change {part('change_given'):.0f} − refunds {part('cash_refunds'):.0f} "
                f"+ tips {part('tips'):.0f} + in {part('cash_in'):.0f} "
                f"− out {part('cash_out'):.0f} = {want:.0f}, drawer says {expected}")
    else:
        rep.ok("J", f"{code} · drawer equals its own parts", f"{float(expected):.0f}")


def _a_shift_can_be_made_compulsory(api: Api, rep: Report, code: str, token: str,
                                    state: dict) -> None:
    """
    `pos_require_shift` is the fence around all of the above.

    Cash from a sale rung with no shift named is real and in the drawer, but the
    drawer never hears about it — so the cashier is OVER at close by exactly
    that amount, with nothing to point at. The till itself cannot ring without a
    shift (Tender is disabled), so this only reaches the API; the setting is what
    closes that door for a shop that wants it closed.

    A setting nobody reads is this codebase's most repeated defect, and this one
    guards the money.
    """
    ring = {
        "channel": "pos",
        "items": [{"product_id": state["product"]["id"], "quantity": 1}],
        "payment_method": "cash", "amount_paid": PRICE,
    }

    status, _ = api.put("/shop/settings", {"pos_require_shift": True}, token=token)
    if status not in (200, 201):
        rep.query("J", f"{code} · turn on pos_require_shift", str(status))
        return

    try:
        status, body = api.post("/sales", ring, token=token)
        if status in (200, 201):
            rep.bug("J", f"{code} · POS_REQUIRE_SHIFT ACTUALLY REFUSES",
                    "a shift-less counter sale went through while the shop demands one")
        else:
            rep.ok("J", f"{code} · shift-less sale refused",
                   (body.get("meta") or {}).get("error_code") or str(status))
    finally:
        api.put("/shop/settings", {"pos_require_shift": False}, token=token)

    # And with it off, the same sale is allowed again — or the setting is a
    # one-way door and the shop can never go back.
    status, _ = api.post("/sales", ring, token=token)
    if status in (200, 201):
        rep.ok("J", f"{code} · setting off, the sale is allowed again")
    else:
        rep.bug("J", f"{code} · TURNING THE SETTING OFF RESTORES SELLING", str(status))


# ── plumbing ───────────────────────────────────────────────────────────

def _open_drawer(api: Api, rep: Report, code: str, token: str) -> str | None:
    status, body = api.get("/pos/session", token=token)
    live = (body.get("data") or {}) if status == 200 else {}
    if live.get("status") == "open":
        return live.get("id")

    status, body = api.post("/pos/session/open", {"opening_float": 5000}, token=token)
    if status not in (200, 201):
        rep.bug("J", f"{code} · open a drawer to spend from", _why(status, body))
        return None
    return (body.get("data") or {}).get("id")


def _close(api: Api, token: str) -> None:
    status, body = api.get("/pos/session/report", token=token)
    expected = ((body.get("data") or {}).get("drawer") or {}).get("expected_cash") if status == 200 else 0
    api.post("/pos/session/close", {"counted_cash": max(float(expected or 0), 0)}, token=token)


def _expected(api: Api, token: str) -> float | None:
    status, body = api.get("/pos/session/report", token=token)
    if status != 200:
        return None
    v = ((body.get("data") or {}).get("drawer") or {}).get("expected_cash")
    return None if v is None else float(v)


def _movement_types(api: Api, token: str) -> set:
    status, body = api.get("/pos/session/movements", token=token)
    return {m.get("type") for m in (_rows(body) if status == 200 else [])}


def _moved(rep: Report, code: str, what: str, before, after, delta: float) -> None:
    if before is None or after is None:
        rep.query("J", f"{code} · {what}", f"drawer figure absent ({before} → {after})")
        return
    got = after - before
    if abs(got - delta) > 0.01:
        rep.bug("J", f"{code} · {what.upper()}",
                f"expected {delta:+.2f}, drawer moved {got:+.2f}")
    else:
        rep.ok("J", f"{code} · {what}", f"{delta:+.0f}")


def _totals(api: Api, token: str) -> dict:
    status, body = api.get("/reports/summary?period=daily", token=token)
    return ((body.get("data") or {}).get("totals") or {}) if status == 200 else {}


def _category(api: Api, token: str, resource: str, name: str) -> str | None:
    status, body = api.get(f"/{resource}", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((r for r in rows if r.get("name") == name), None)
    if found:
        return found["id"]
    status, body = api.post(f"/{resource}", {"name": name}, token=token)
    return (body.get("data") or {}).get("id") if status in (200, 201) else (rows[0]["id"] if rows else None)


def _supplier(api: Api, token: str) -> str | None:
    status, body = api.get("/suppliers?search=Sweep+Supplier", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((r for r in rows if r.get("name") == "Sweep Supplier"), None)
    if found:
        return found["id"]
    status, body = api.post("/suppliers", {"name": "Sweep Supplier"}, token=token)
    return (body.get("data") or {}).get("id") if status in (200, 201) else None


def _any_product(api: Api, token: str) -> str | None:
    status, body = api.get("/products?search=Sweep+Item", token=token)
    rows = _rows(body) if status == 200 else []
    return rows[0]["id"] if rows else None


def _today(api: Api) -> str:
    status, body = api.get("/health")
    return (((body.get("data") or {}).get("time") if status == 200 else None)
            or "2026-08-18T00:00:00+00:00")[:10]


def _why(status: int, body: dict) -> str:
    return f"{status} {body.get('errors') or body.get('message')}"


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
