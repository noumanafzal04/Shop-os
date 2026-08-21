"""
Phase E — money that is not a sale.

The till is the loud half of a shop's money. The quiet half is the electricity
bill, the scrap sold to the kabaria, and the regular who takes goods on khata and
settles on the first of the month. A system that gets selling right and this
wrong tells the shopkeeper they had a good month when they did not.

The check that matters most here is arithmetic the sweep does itself:

    gross_profit = revenue − cogs
    net_profit   = gross_profit + other_income − expenses

Recorded income missing from the profit line has already shipped once in this
codebase. It is the perfect silent bug: nothing errors, no screen is blank, the
figure is simply lower than the truth, for ever.
"""

from api import Api, Report
from phase_c import PRICE

EXPENSE = 1234.0
INCOME = 777.0
KHATA_PHONE = "03009998877"


def run(api: Api, rep: Report, sold: dict, books_only: dict | None = None) -> dict:
    out: dict[str, dict] = {}

    for code, state in sold.items():
        token = state["token"]
        feats = state.get("features") or {}

        _the_books(api, rep, code, token, feats)
        _profit_is_arithmetic(api, rep, code, token)
        # A khata charge is a SALE on credit, so it needs something to sell.
        _khata(api, rep, code, token, state)

        out[code] = state

    # ── the shops with books and no till ────────────────────────────────
    #
    # `finance` is a whole business type whose only module is `expenses`, and
    # phase C skips anything without a till — so every phase after C, this one
    # included, had never once spoken about it. The money screens were covered,
    # on other shops; the type made ENTIRELY of money screens was not.
    #
    # Everything below the khata line needs only a token, so it runs here too.
    for code, state in (books_only or {}).items():
        token = state["token"]
        _the_books(api, rep, code, token, state.get("features") or {})
        _profit_is_arithmetic(api, rep, code, token)
        rep.ok("E", f"{code} · books without a till", "no sale to make, so no khata")

    return out


def _the_books(api: Api, rep: Report, code: str, token: str, feats: dict) -> None:
    """The three that need nothing but a token and the expense module."""
    if not feats.get("expenses"):
        rep.ok("E", f"{code} · no expense module", "skipped, correctly")
        return

    _expense_reaches_the_books(api, rep, code, token)
    _income_reaches_the_profit(api, rep, code, token)
    _cashbook_balances(api, rep, code, token)


# ── the quiet half ─────────────────────────────────────────────────────

def _expense_reaches_the_books(api: Api, rep: Report, code: str, token: str) -> None:
    """An expense recorded is an expense the summary and the cashbook both see."""
    before_sum = _totals(api, token, "/reports/summary?period=daily")
    before_cash = _totals(api, token, "/cashbook")

    cat = _category(api, token, "expense-categories", "Sweep Expense")
    payload = {
        "description": "QA sweep expense",
        "amount": EXPENSE,
        "expense_date": _today(api, token),
        "payment_method": "cash",
    }
    if cat:
        payload["expense_category_id"] = cat

    status, body = api.post("/expenses", payload, token=token)
    if status not in (200, 201):
        rep.bug("E", f"{code} · record an expense", f"{status} {body.get('errors') or body.get('message')}")
        return

    after_sum = _totals(api, token, "/reports/summary?period=daily")
    after_cash = _totals(api, token, "/cashbook")

    _moved(rep, "E", code, "expense reaches the summary",
           before_sum.get("expenses"), after_sum.get("expenses"), EXPENSE)
    _moved(rep, "E", code, "expense reaches the cashbook",
           before_cash.get("expenses"), after_cash.get("expenses"), EXPENSE)

    # And it must come OFF the profit, not merely appear beside it.
    _moved(rep, "E", code, "expense comes off net profit",
           before_sum.get("net_profit"), after_sum.get("net_profit"), -EXPENSE)


def _income_reaches_the_profit(api: Api, rep: Report, code: str, token: str) -> None:
    """
    Money in that was not a sale.

    Scrap sold, a sublet fridge, a commission. This exact line has been missing
    from the profit figure in this codebase before, and nothing about the screen
    looked wrong — the number was simply too low.
    """
    before = _totals(api, token, "/reports/summary?period=daily")

    cat = _category(api, token, "income-categories", "Sweep Income")
    payload = {
        "description": "QA sweep income",
        "amount": INCOME,
        "income_date": _today(api, token),
        "payment_method": "cash",
    }
    if cat:
        payload["income_category_id"] = cat

    status, body = api.post("/incomes", payload, token=token)
    if status not in (200, 201):
        rep.bug("E", f"{code} · record income", f"{status} {body.get('errors') or body.get('message')}")
        return

    after = _totals(api, token, "/reports/summary?period=daily")

    _moved(rep, "E", code, "income is recorded",
           before.get("other_income"), after.get("other_income"), INCOME)
    _moved(rep, "E", code, "INCOME REACHES NET PROFIT",
           before.get("net_profit"), after.get("net_profit"), INCOME, loud=True)


def _cashbook_balances(api: Api, rep: Report, code: str, token: str) -> None:
    """
    The cashbook derives; it must not also duplicate.

    Its whole design is that sales revenue and refunds are READ from the sales
    table rather than written twice. If `net` ever stops being money in minus
    money out, something is being counted on both sides.
    """
    t = _totals(api, token, "/cashbook")
    if not t:
        rep.bug("E", f"{code} · cashbook", "no totals")
        return

    money_in = float(t.get("money_in") or 0)
    money_out = float(t.get("money_out") or 0)
    net = float(t.get("net") or 0)

    if abs((money_in - money_out) - net) > 0.01:
        rep.bug("E", f"{code} · CASHBOOK NET IS IN MINUS OUT",
                f"in {money_in} − out {money_out} = {money_in - money_out}, but net says {net}")
    else:
        rep.ok("E", f"{code} · cashbook balances", f"in {money_in:.0f} − out {money_out:.0f} = {net:.0f}")

    # Money in is derived from sales + income; it can never be less than the
    # sales it derives from, which is the cheapest way to catch a broken join.
    revenue = float(t.get("sales_revenue") or 0)
    if revenue > money_in + 0.01:
        rep.bug("E", f"{code} · cashbook money-in includes its sales",
                f"sales {revenue} > money_in {money_in}")


def _profit_is_arithmetic(api: Api, rep: Report, code: str, token: str) -> None:
    """
    The two identities the summary must satisfy, whatever else it does.

    Checked against the report's OWN figures, so this holds no matter what the
    sweep did before it — which is the point: it is a statement about the
    report's internal consistency, not about this run.
    """
    t = _totals(api, token, "/reports/summary?period=daily")
    if not t:
        rep.bug("E", f"{code} · summary report", "no totals")
        return

    revenue = float(t.get("revenue") or 0)
    cogs = float(t.get("cogs") or 0)
    gross = float(t.get("gross_profit") or 0)
    other = float(t.get("other_income") or 0)
    expenses = float(t.get("expenses") or 0)
    net = float(t.get("net_profit") or 0)

    if abs((revenue - cogs) - gross) > 0.01:
        rep.bug("E", f"{code} · GROSS PROFIT IS REVENUE MINUS COGS",
                f"{revenue} − {cogs} = {revenue - cogs}, report says {gross}")
    else:
        rep.ok("E", f"{code} · gross = revenue − cogs", f"{gross:.0f}")

    want = gross + other - expenses
    if abs(want - net) > 0.01:
        rep.bug("E", f"{code} · NET PROFIT SEES INCOME AND EXPENSES",
                f"gross {gross} + income {other} − expenses {expenses} = {want}, report says {net}")
    else:
        rep.ok("E", f"{code} · net = gross + income − expenses", f"{net:.0f}")


# ── khata ──────────────────────────────────────────────────────────────

def _khata(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    Goods now, money later — the arrangement most Pakistani shops actually run
    on. Three things must hold: the balance rises by exactly what was taken, a
    repayment brings it down, and overpaying is REFUSED rather than silently
    banked as an advance nobody chose.
    """
    customer = _customer(api, token)
    if customer is None:
        rep.query("E", f"{code} · khata customer", "could not create one")
        return

    # `amount_paid` is the FULL bill, not zero — the credit tender COVERS the
    # sale and the money then moves onto the khata. Sending 0 is refused with
    # "amount paid is less than the total", which reads exactly like khata being
    # broken; it is the shop's own rule that a bill is never left partly
    # unaccounted for. The till sends `amount_paid: payable` for credit
    # (PosPage.tsx:1036) and this sweep must send what the till sends.
    before = _balance(api, token, customer)
    status, body = api.post("/sales", {
        "channel": "pos",
        "customer_name": "Sweep Khata",
        "customer_phone": KHATA_PHONE,
        "items": [{"product_id": state["product"]["id"], "quantity": 1}],
        "payment_method": "credit",
        "amount_paid": PRICE,
    }, token=token)

    if status not in (200, 201):
        rep.bug("E", f"{code} · sell on credit", f"{status} {body.get('message')}")
        return

    owed = float((body.get("data") or {}).get("total") or 0)
    after = _balance(api, token, customer)

    if before is None or after is None:
        rep.query("E", f"{code} · khata balance is readable", "no credit_balance")
        return

    if abs((after - before) - owed) > 0.01:
        rep.bug("E", f"{code} · CREDIT SALE LANDS ON THE KHATA",
                f"sold {owed} on credit, balance moved {before} → {after}")
        return

    rep.ok("E", f"{code} · credit sale on the khata", f"+{owed:.0f}")

    # Overpaying must be refused, not banked.
    status, body = api.post(f"/customers/{customer}/payments",
                            {"amount": after + 500, "method": "cash"}, token=token)
    if status in (200, 201):
        rep.bug("E", f"{code} · OVERPAYMENT IS DELIBERATE",
                f"paid {after + 500} against {after} owed and it was accepted silently")
    else:
        rep.ok("E", f"{code} · overpayment refused", body.get("error_code") or str(status))

    # A repayment of exactly what is owed clears it.
    status, body = api.post(f"/customers/{customer}/payments",
                            {"amount": after, "method": "cash"}, token=token)
    if status not in (200, 201):
        rep.bug("E", f"{code} · settle the khata", f"{status} {body.get('errors') or body.get('message')}")
        return

    cleared = _balance(api, token, customer)
    if cleared is None or abs(cleared) > 0.01:
        rep.bug("E", f"{code} · SETTLING CLEARS THE KHATA", f"paid {after}, balance now {cleared}")
    else:
        rep.ok("E", f"{code} · khata settled to zero")


# ── plumbing ───────────────────────────────────────────────────────────

def _moved(rep: Report, phase: str, code: str, what: str,
           before, after, delta: float, loud: bool = False) -> None:
    if before is None or after is None:
        rep.query(phase, f"{code} · {what}", f"figure absent (before={before}, after={after})")
        return
    got = float(after) - float(before)
    if abs(got - delta) > 0.01:
        rep.bug(phase, f"{code} · {what.upper() if loud else what}",
                f"expected a move of {delta:+.2f}, saw {got:+.2f}")
    else:
        rep.ok(phase, f"{code} · {what}", f"{delta:+.0f}")


def _totals(api: Api, token: str, path: str) -> dict:
    status, body = api.get(path, token=token)
    if status != 200:
        return {}
    return (body.get("data") or {}).get("totals") or {}


def _today(api: Api, token: str) -> str:
    status, body = api.get("/health")
    stamp = (body.get("data") or {}).get("time") if status == 200 else None
    return (stamp or "2026-08-18T00:00:00+00:00")[:10]


def _category(api: Api, token: str, resource: str, name: str) -> str | None:
    status, body = api.get(f"/{resource}", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((r for r in rows if r.get("name") == name), None)
    if found:
        return found["id"]
    status, body = api.post(f"/{resource}", {"name": name}, token=token)
    return (body.get("data") or {}).get("id") if status in (200, 201) else (rows[0]["id"] if rows else None)


def _customer(api: Api, token: str) -> str | None:
    status, body = api.get(f"/customers?search={KHATA_PHONE}", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((r for r in rows if r.get("phone") == KHATA_PHONE), None)
    if found:
        return found["id"]
    status, body = api.post("/customers", {
        "name": "Sweep Khata", "phone": KHATA_PHONE, "credit_limit": 100000,
    }, token=token)
    return (body.get("data") or {}).get("id") if status in (200, 201) else None


def _balance(api: Api, token: str, customer_id: str) -> float | None:
    status, body = api.get(f"/customers/{customer_id}", token=token)
    if status != 200:
        return None
    b = (body.get("data") or {}).get("credit_balance")
    return None if b is None else float(b)


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
