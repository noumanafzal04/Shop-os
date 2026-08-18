"""
Phase L — the floor.

A restaurant's till is the LAST thing to hear what happened. Food is ordered at
a table, cooked in a kitchen that never sees a price, and paid for at the end —
sometimes by four people who each want their own bill. Between the order and the
money there is a tab that has to survive a table change, a merge, a waiter going
home, and a kitchen that only needs to know what to cook.

Four things, and each is a different kind of wrong:

    THE TAB IS THE UNIT     items added over an hour, priced once, at the end
    THE PASS SEES FOOD      a KOT carries the dish and the note, never the money
    SPLIT TAKES A PART      settling three of five items leaves two owing, not
                            a closed tab and a customer who walked
    A TABLE HAS AN OWNER    a waiter's own tables are what the service report
                            pays tips off; it stops being true the moment
                            anyone can settle anyone's bill
"""

from api import Api, Report

# One table per check. Sharing a table meant each check reused the previous
# one's still-open tab: the split check found six covers instead of five and
# the ownership check found a 2,100 bill it was tendering 350 against. Both
# read as product bugs and were the sweep piling its own plates up.
TABLES = {
    "run": "Sweep Table · Tab",
    "kitchen": "Sweep Table · Pass",
    "split": "Sweep Table · Split",
    "owner": "Sweep Table · Waiter",
}
GUESTS = 4


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code, state in sold.items():
        if not (state.get("features") or {}).get("dine_in"):
            continue

        token = state["token"]
        dish = _dish(api, rep, code, token, state)
        if dish is None:
            continue

        tables = {k: _table(api, rep, code, token, name) for k, name in TABLES.items()}
        if any(t is None for t in tables.values()):
            continue

        _a_tab_runs_then_settles(api, rep, code, token, tables["run"], dish)
        _the_kitchen_sees_food_not_money(api, rep, code, token, tables["kitchen"], dish)
        _a_split_leaves_the_rest_owing(api, rep, code, token, tables["split"], dish)
        _a_table_belongs_to_its_waiter(api, rep, code, token, tables["owner"], dish, state)

    return sold


# ── the tab ────────────────────────────────────────────────────────────

def _a_tab_runs_then_settles(api: Api, rep: Report, code: str, token: str,
                             table: dict, dish: dict) -> None:
    """
    Open, add over time, settle once.

    A tab is not a sale until it is paid. Two rounds go on it, and the bill at
    the end is the sum of both — priced by the server, like everything else.
    """
    ticket = _open_tab(api, rep, code, token, table)
    if ticket is None:
        return

    for qty in (2, 3):
        status, body = api.post(f"/restaurant/tickets/{ticket['id']}/items", {
            "items": [{"product_id": dish["id"], "quantity": qty}],
        }, token=token)
        if status not in (200, 201):
            rep.bug("L", f"{code} · add a round to the tab", _why(status, body))
            return

    status, body = api.get(f"/restaurant/tickets/{ticket['id']}", token=token)
    tab = (body.get("data") or {}) if status == 200 else {}
    items = tab.get("items") or []
    price = float(dish.get("price") or 0)

    if len(items) < 1:
        rep.bug("L", f"{code} · THE TAB KEEPS WHAT WAS ORDERED", "no items after two rounds")
        return

    ordered = sum(float(i.get("quantity") or 0) for i in items)
    if abs(ordered - 5) > 0.001:
        rep.bug("L", f"{code} · TWO ROUNDS BOTH LAND ON THE TAB",
                f"ordered 2 then 3, the tab holds {ordered}")
    else:
        rep.ok("L", f"{code} · tab holds both rounds", "5 covers")

    # `running_total`, not `total` — a tab is not a sale until it is paid, and
    # the name says so. Reading `total` gives None and the sweep reports a
    # correctly-priced tab as charging nothing.
    due = float(tab.get("running_total") or 0)
    if abs(due - 5 * price) > 0.01:
        rep.query("L", f"{code} · the tab is priced by the server",
                  f"5 × {price:.0f} = {5 * price:.0f}, tab says {due}")
    else:
        rep.ok("L", f"{code} · tab priced by the server", f"{due:.0f}")

    status, body = api.post(f"/restaurant/tickets/{ticket['id']}/settle", {
        "payment_method": "cash", "amount_paid": max(due, 5 * price),
    }, token=token)

    if status not in (200, 201):
        rep.bug("L", f"{code} · settle the tab", _why(status, body))
        return

    rep.ok("L", f"{code} · tab settled")

    # And the table is free again — otherwise the floor fills up with tables
    # nobody is sitting at.
    status, body = api.get(f"/restaurant/tables/{table['id']}", token=token)
    live = (body.get("data") or {}) if status == 200 else {}
    open_tab = live.get("open_ticket") or live.get("ticket")
    if open_tab:
        rep.bug("L", f"{code} · A SETTLED TABLE IS FREE AGAIN",
                "the table still shows an open tab after it was paid")
    else:
        rep.ok("L", f"{code} · table free after settling")


def _the_kitchen_sees_food_not_money(api: Api, rep: Report, code: str, token: str,
                                     table: dict, dish: dict) -> None:
    """
    Firing a course puts it on the pass.

    The board must carry the dish and the note — "no chilli" is the only thing
    that matters back there — and it must carry no prices at all. A kitchen
    screen showing the bill is how a kitchen hand ends up knowing the shop's
    takings, which is the permission bug this codebase already fixed once.
    """
    ticket = _open_tab(api, rep, code, token, table)
    if ticket is None:
        return

    status, body = api.post(f"/restaurant/tickets/{ticket['id']}/items", {
        "items": [{"product_id": dish["id"], "quantity": 1, "note": "no chilli"}],
    }, token=token)
    if status not in (200, 201):
        rep.bug("L", f"{code} · order a dish to fire", _why(status, body))
        return

    status, body = api.post(f"/restaurant/tickets/{ticket['id']}/fire", {}, token=token)
    if status not in (200, 201):
        rep.bug("L", f"{code} · fire the course", _why(status, body))
        return

    rep.ok("L", f"{code} · course fired to the kitchen")

    status, body = api.get("/restaurant/kitchen", token=token)
    if status != 200:
        rep.bug("L", f"{code} · the kitchen board", str(status))
        return

    # `{kots, stations, server_time}` — and a KOT names the TICKET NUMBER and
    # the table, not the ticket id. Right: the pass identifies work by what is
    # written on the docket, which is what the kitchen can actually see.
    board = (body.get("data") or {}).get("kots") or []
    number = ticket.get("ticket_number")
    mine = [k for k in board if k.get("ticket_number") == number]
    if not mine:
        rep.bug("L", f"{code} · A FIRED COURSE REACHES THE PASS",
                f"the board has {len(board)} dockets, none of them {number}")
        return

    kot = mine[0]
    text = str(kot)
    if "no chilli" not in text:
        rep.query("L", f"{code} · the note reaches the kitchen", "'no chilli' not on the KOT")
    else:
        rep.ok("L", f"{code} · the dish and its note reached the pass")

    # No money on the pass.
    for money in ("total", "price", "unit_price", "line_total", "amount"):
        if money in kot:
            rep.query("L", f"{code} · the pass carries no prices", f"KOT has `{money}`")
            break
    else:
        rep.ok("L", f"{code} · no prices on the pass")

    # Bumping it is the kitchen's own action.
    kot_id = kot.get("id")
    if kot_id:
        status, _ = api.post(f"/restaurant/kitchen/kot/{kot_id}/bump", {"status": "ready"}, token=token)
        if status in (200, 201):
            rep.ok("L", f"{code} · marked ready on the pass")
        else:
            rep.query("L", f"{code} · bump a KOT", str(status))

    api.post(f"/restaurant/tickets/{ticket['id']}/cancel", {"reason": "QA sweep"}, token=token)


def _a_split_leaves_the_rest_owing(api: Api, rep: Report, code: str, token: str,
                                   table: dict, dish: dict) -> None:
    """
    Four people, one table, separate bills.

    Settling part of a tab must take exactly that part and leave the tab OPEN
    for the rest. Closing the whole thing is how a table walks out having paid
    for one plate of five.
    """
    ticket = _open_tab(api, rep, code, token, table)
    if ticket is None:
        return

    status, body = api.post(f"/restaurant/tickets/{ticket['id']}/items", {
        "items": [{"product_id": dish["id"], "quantity": 5}],
    }, token=token)
    if status not in (200, 201):
        return

    status, body = api.get(f"/restaurant/tickets/{ticket['id']}", token=token)
    tab = (body.get("data") or {}) if status == 200 else {}
    items = tab.get("items") or []
    if not items:
        return

    price = float(dish.get("price") or 0)
    line = items[0]

    status, body = api.post(f"/restaurant/tickets/{ticket['id']}/settle", {
        "splits": [{"id": line["id"], "quantity": 2}],
        "payment_method": "cash", "amount_paid": 2 * price,
    }, token=token)

    if status not in (200, 201):
        rep.bug("L", f"{code} · settle two of five", _why(status, body))
        return

    d = body.get("data") or {}
    paid = float((d.get("sale") or {}).get("total") or d.get("total") or 0)
    if abs(paid - 2 * price) > 0.01:
        rep.query("L", f"{code} · the split bill is for its own share",
                  f"2 × {price:.0f} = {2 * price:.0f}, charged {paid}")
    else:
        rep.ok("L", f"{code} · split bill charged 2 of 5", f"{paid:.0f}")

    status, body = api.get(f"/restaurant/tickets/{ticket['id']}", token=token)
    rest = (body.get("data") or {}) if status == 200 else {}
    # A partial settle CARVES the line in two: a paid row stamped with the sale
    # and the original left holding the remainder. So both rows are still on the
    # tab, and "what is owed" is the ones with no sale against them. Summing
    # every row said 5 of 5 were still owing, which read as the split having
    # taken nothing.
    paid, unpaid = _split_of(rest.get("items") or [])

    if rest.get("status") in ("settled", "closed", "paid"):
        rep.bug("L", f"{code} · A SPLIT LEAVES THE REST OWING",
                "the whole tab closed when two of five items were paid")
    elif abs(unpaid - 3) > 0.001:
        rep.bug("L", f"{code} · A SPLIT LEAVES THE REST OWING",
                f"5 ordered, 2 paid, {unpaid} still unpaid")
    else:
        rep.ok("L", f"{code} · three covers still owing")

    # The carve must conserve. A paid row plus a remainder that do not sum back
    # to what was ordered is a plate that either walked out free or got billed
    # twice, and the tab would still look tidy.
    if abs((paid + unpaid) - 5) > 0.001:
        rep.bug("L", f"{code} · A SPLIT CARVES, IT DOES NOT LOSE",
                f"5 ordered, {paid} paid + {unpaid} unpaid = {paid + unpaid}")
    else:
        rep.ok("L", f"{code} · the carve conserves", f"{paid:.0f} paid + {unpaid:.0f} owing = 5")

    api.post(f"/restaurant/tickets/{ticket['id']}/settle", {
        "payment_method": "cash", "amount_paid": 3 * price,
    }, token=token)


def _a_table_belongs_to_its_waiter(api: Api, rep: Report, code: str, token: str,
                                   table: dict, dish: dict, state: dict) -> None:
    """
    A waiter's own tables are the unit the service report pays tips off.

    So a plain waiter must not be able to settle a table that is not theirs —
    and a CASHIER must, because the till settles what the floor opened. Those
    two facts are one permission apart (`tables.serve_any`), and getting either
    one wrong breaks the other person's job.
    """
    waiter = _staff(api, token, f"sweep-{code}-floor-waiter@qa.test",
                    "Sweep Floor Waiter", ["sales.manage", "customers.manage"])
    other = _staff(api, token, f"sweep-{code}-other-waiter@qa.test",
                   "Sweep Other Waiter", ["sales.manage", "customers.manage"])
    cashier = _staff(api, token, f"sweep-{code}-floor-cashier@qa.test",
                     "Sweep Floor Cashier",
                     ["sales.manage", "customers.manage", "tables.serve_any"])

    if not (waiter and other and cashier):
        rep.query("L", f"{code} · floor staff to test ownership with", "could not hire them")
        return

    ticket = _open_tab(api, rep, code, waiter, table)
    if ticket is None:
        return

    api.post(f"/restaurant/tickets/{ticket['id']}/items", {
        "items": [{"product_id": dish["id"], "quantity": 1}],
    }, token=waiter)

    price = float(dish.get("price") or 0)
    bill = {"payment_method": "cash", "amount_paid": price}

    # Another waiter must not take it.
    status, _ = api.post(f"/restaurant/tickets/{ticket['id']}/settle", bill, token=other)
    if status in (200, 201):
        rep.bug("L", f"{code} · A TABLE BELONGS TO ITS WAITER",
                "another waiter settled a table that was not theirs")
        return
    rep.ok("L", f"{code} · another waiter cannot settle it", str(status))

    # The cashier must.
    status, body = api.post(f"/restaurant/tickets/{ticket['id']}/settle", bill, token=cashier)
    if status in (200, 201):
        rep.ok("L", f"{code} · the till settles what the floor opened")
    else:
        rep.bug("L", f"{code} · A CASHIER CAN SETTLE ANY TABLE",
                f"{_why(status, body)} — a cashier who cannot pick up a waiter's tab "
                "cannot take the payment")
        api.post(f"/restaurant/tickets/{ticket['id']}/cancel", {"reason": "QA sweep"}, token=token)


# ── plumbing ───────────────────────────────────────────────────────────

def _split_of(lines: list) -> tuple:
    """
    What is paid and what is owed on a carved tab.

    Its own function so a mutation can lie about it — the split check reads the
    ticket's `items` directly, not through `_rows`, and a mutation aimed at the
    wrong reader is a mutation that proves nothing while looking like a blind
    check.
    """
    paid = sum(float(i.get("quantity") or 0) for i in lines if i.get("sale_id"))
    unpaid = sum(float(i.get("quantity") or 0) for i in lines if not i.get("sale_id"))
    return paid, unpaid


def _open_tab(api: Api, rep: Report, code: str, token: str, table: dict) -> dict | None:
    """This table's open tab, or a new one."""
    status, body = api.get("/restaurant/tickets", token=token)
    live = next((t for t in _rows(body) if t.get("dining_table_id") == table["id"]
                 and t.get("status") in ("open", "running")), None) if status == 200 else None
    if live:
        return live

    status, body = api.post("/restaurant/tickets", {
        "order_type": "dine_in", "dining_table_id": table["id"], "guest_count": GUESTS,
    }, token=token)
    if status not in (200, 201):
        rep.bug("L", f"{code} · open a tab", _why(status, body))
        return None
    return body.get("data") or {}


def _table(api: Api, rep: Report, code: str, token: str, name: str) -> dict | None:
    status, body = api.get("/restaurant/tables", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((t for t in rows if t.get("name") == name), None)
    if found:
        return found

    status, body = api.post("/restaurant/tables", {"name": name, "seats": 4, "area": "Sweep"}, token=token)
    if status not in (200, 201):
        rep.bug("L", f"{code} · lay a table", _why(status, body))
        return None
    rep.ok("L", f"{code} · table laid", name)
    return body.get("data") or {}


def _dish(api: Api, rep: Report, code: str, token: str, state: dict) -> dict | None:
    name = "Sweep Dine-in Dish"
    status, body = api.get(f"/products?search={name.replace(' ', '+')}", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((p for p in rows if p.get("name") == name), None)
    if found:
        return found

    item_type = "food_item" if "food_item" in (state.get("item_types") or []) else state["item_type"]
    status, body = api.post("/products", {
        "item_type": item_type, "name": name, "price": 350, "cost": 120,
        "tax_rate": 0, "track_inventory": False,
    }, token=token)
    if status not in (200, 201):
        rep.bug("L", f"{code} · a dish to order", _why(status, body))
        return None
    return body.get("data") or {}


def _staff(api: Api, owner: str, email: str, name: str, permissions: list) -> str | None:
    status, body = api.post("/staff", {
        "name": name, "email": email, "password": "password", "permissions": permissions,
    }, token=owner)
    if status not in (200, 201):
        errs = " ".join(m for msgs in (body.get("errors") or {}).values() for m in msgs).lower()
        if "already" not in errs and "taken" not in errs:
            return None
    return api.login(email)


def _why(status: int, body: dict) -> str:
    return f"{status} {body.get('errors') or body.get('message')}"


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
