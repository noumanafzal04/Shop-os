"""
Phase K — more than one shop under one roof.

A branch is a sub-unit, not a tenant: one catalog, one customer list, one set of
books — and **stock that is in one place and not the other.** That last part is
the whole subject. Everything that goes wrong with multi-branch goes wrong
because a quantity was read without asking where it was.

Four things, and the fourth is the one nobody thinks to check:

    SEPARATE      what is on the shelf at Saddar is not on the shelf at Gulberg
    CONSERVED     a transfer MOVES stock; it never creates or destroys any
    VISIBLE       the counter can see what the other branch holds, or the answer
                  to "do you have it in blue?" is a phone call
    FENCED        an owner may work any branch; STAFF may not. A cashier
                  assigned to Gulberg who sends a header naming Saddar must
                  still sell out of Gulberg's stock — otherwise branch
                  assignment is a label, and one shop's shelf empties into
                  another's takings.
"""

from api import Api, Report
from phase_c import PRICE

SECOND = "Sweep Second Branch"
AT_MAIN = 60
AT_SECOND = 25
MOVE = 10


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code in ("mart", "retail"):
        state = sold.get(code)
        if state is None or not (state.get("features") or {}).get("inventory"):
            continue

        token = state["token"]
        branches = _branches(api, rep, code, token)
        if branches is None:
            continue

        main, second = branches
        pid = state["product"]["id"]

        _stock_is_per_branch(api, rep, code, token, pid, main, second)
        _both_shelves_are_visible(api, rep, code, token, pid, main, second)
        _a_transfer_moves_and_conserves(api, rep, code, token, pid, main, second)
        _a_transfer_cannot_send_what_is_not_there(api, rep, code, token, pid, main, second)
        _hq_is_the_sum_of_its_branches(api, rep, code, token, pid, main, second)
        _staff_cannot_wander(api, rep, code, state, token, pid, main, second)

    return sold


# ── separate shelves ───────────────────────────────────────────────────

def _stock_is_per_branch(api: Api, rep: Report, code: str, token: str,
                         pid: str, main: dict, second: dict) -> None:
    """Set each shelf on its own, and each must hold what it was given."""
    _set_stock(api, token, pid, main["id"], AT_MAIN)
    _set_stock(api, token, pid, second["id"], AT_SECOND)

    at_main = _stock_at(api, token, pid, main["id"])
    at_second = _stock_at(api, token, pid, second["id"])

    if at_main is None or at_second is None:
        rep.bug("K", f"{code} · stock is readable per branch", f"{at_main} / {at_second}")
        return

    if abs(at_main - AT_MAIN) > 0.001 or abs(at_second - AT_SECOND) > 0.001:
        rep.bug("K", f"{code} · A SHELF HOLDS ONLY ITS OWN BRANCH'S STOCK",
                f"set {AT_MAIN}/{AT_SECOND}, read {at_main}/{at_second}")
    elif abs(at_main - at_second) < 0.001:
        rep.bug("K", f"{code} · TWO BRANCHES ARE TWO SHELVES",
                f"both read {at_main} — one quantity is being shown for both")
    else:
        rep.ok("K", f"{code} · stock is per branch", f"Main {at_main:.0f}, second {at_second:.0f}")


def _both_shelves_are_visible(api: Api, rep: Report, code: str, token: str,
                              pid: str, main: dict, second: dict) -> None:
    """
    "Do you have it at the other branch?" is the most-asked question on a
    two-shop counter, and a system that cannot answer it turns every one into a
    phone call.
    """
    status, body = api.get(f"/products/{pid}/branch-stock", token=token)
    if status != 200:
        rep.bug("K", f"{code} · the counter can see the other branch", str(status))
        return

    rows = {r.get("branch_id"): float(r.get("quantity") or 0) for r in _rows(body)}
    if main["id"] not in rows or second["id"] not in rows:
        rep.bug("K", f"{code} · CROSS-BRANCH LOOKUP NAMES EVERY BRANCH",
                f"{len(rows)} rows, missing one of the two")
    else:
        rep.ok("K", f"{code} · cross-branch lookup",
               f"Main {rows[main['id']]:.0f} · second {rows[second['id']]:.0f}")


# ── a transfer ─────────────────────────────────────────────────────────

def _a_transfer_moves_and_conserves(api: Api, rep: Report, code: str, token: str,
                                    pid: str, main: dict, second: dict) -> None:
    """
    Ten off one shelf and ten onto the other. Both halves, and the total.

    Checking only the destination is how a transfer that never depletes the
    source ships: the goods appear at Gulberg and stay at Saddar, and the shop
    believes it owns twice what it has until somebody counts.
    """
    before_main = _stock_at(api, token, pid, main["id"])
    before_second = _stock_at(api, token, pid, second["id"])
    if before_main is None or before_second is None:
        return

    status, body = api.post("/inventory/transfers", {
        "from_branch_id": main["id"], "to_branch_id": second["id"],
        "notes": "QA sweep transfer",
        "items": [{"product_id": pid, "quantity": MOVE}],
    }, token=token)

    if status not in (200, 201):
        rep.bug("K", f"{code} · transfer stock between branches", _why(status, body))
        return

    after_main = _stock_at(api, token, pid, main["id"])
    after_second = _stock_at(api, token, pid, second["id"])

    took = before_main - after_main
    gave = after_second - before_second

    if abs(took - MOVE) > 0.001:
        rep.bug("K", f"{code} · A TRANSFER DEPLETES THE SOURCE",
                f"sent {MOVE}, Main went {before_main:.0f} → {after_main:.0f}")
    elif abs(gave - MOVE) > 0.001:
        rep.bug("K", f"{code} · A TRANSFER ARRIVES AT THE DESTINATION",
                f"sent {MOVE}, second branch went {before_second:.0f} → {after_second:.0f}")
    else:
        rep.ok("K", f"{code} · transfer moved {MOVE}", f"Main −{took:.0f}, second +{gave:.0f}")

    total_before = before_main + before_second
    total_after = after_main + after_second
    if abs(total_before - total_after) > 0.001:
        rep.bug("K", f"{code} · A TRANSFER CREATES AND DESTROYS NOTHING",
                f"the shop held {total_before:.0f} before and {total_after:.0f} after")
    else:
        rep.ok("K", f"{code} · nothing created or lost in transit", f"{total_after:.0f} either side")


def _a_transfer_cannot_send_what_is_not_there(api: Api, rep: Report, code: str, token: str,
                                              pid: str, main: dict, second: dict) -> None:
    """A branch cannot ship stock it does not hold."""
    have = _stock_at(api, token, pid, main["id"]) or 0

    status, body = api.post("/inventory/transfers", {
        "from_branch_id": main["id"], "to_branch_id": second["id"],
        "items": [{"product_id": pid, "quantity": have + 500}],
    }, token=token)

    after = _stock_at(api, token, pid, main["id"])

    if status in (200, 201):
        rep.bug("K", f"{code} · A BRANCH CANNOT SEND WHAT IT DOES NOT HOLD",
                f"shipped {have + 500:.0f} out of {have:.0f}; Main now {after}")
    else:
        rep.ok("K", f"{code} · over-transfer refused", str(status))
        if after is not None and abs(after - have) > 0.001:
            rep.bug("K", f"{code} · A REFUSED TRANSFER MOVES NOTHING",
                    f"Main went {have:.0f} → {after:.0f} on a rejected transfer")


# ── the HQ view ────────────────────────────────────────────────────────

def _hq_is_the_sum_of_its_branches(api: Api, rep: Report, code: str, token: str,
                                   pid: str, main: dict, second: dict) -> None:
    """
    No branch header is the owner's all-branches view; a header focuses one.

    The arithmetic has to hold, or the owner reads a figure that is neither the
    shop nor a branch — and the two screens sit next to each other.
    """
    hq = _valuation_qty(api, token, pid, None)
    at_main = _valuation_qty(api, token, pid, main["id"])
    at_second = _valuation_qty(api, token, pid, second["id"])

    if hq is None or at_main is None or at_second is None:
        rep.query("K", f"{code} · valuation per branch",
                  f"HQ {hq}, main {at_main}, second {at_second}")
        return

    if abs(hq - (at_main + at_second)) > 0.001:
        rep.bug("K", f"{code} · HQ IS THE SUM OF ITS BRANCHES",
                f"all-branches says {hq:.0f}, but {at_main:.0f} + {at_second:.0f} "
                f"= {at_main + at_second:.0f}")
    else:
        rep.ok("K", f"{code} · HQ = branch + branch", f"{at_main:.0f} + {at_second:.0f} = {hq:.0f}")


# ── the fence ──────────────────────────────────────────────────────────

def _staff_cannot_wander(api: Api, rep: Report, code: str, state: dict, owner: str,
                         pid: str, main: dict, second: dict) -> None:
    """
    An owner may work any branch. Staff may not.

    A cashier assigned to the second branch who sends `X-Branch-Id` naming Main
    must still sell out of the second branch's stock. If the header moved them,
    branch assignment would be decoration: one shop's shelf would empty into
    another shop's takings, and both sets of books would be wrong in opposite
    directions.

    Observed the only way that cannot be faked — by which shelf went down.
    """
    email = f"sweep-{code}-branch-cashier@qa.test"
    status, body = api.post("/staff", {
        "name": "Sweep Branch Cashier",
        "email": email,
        "password": "password",
        "branch_id": second["id"],
        "permissions": ["sales.manage", "customers.manage"],
    }, token=owner)

    if status not in (200, 201) and not _already(body):
        rep.query("K", f"{code} · hire a cashier at the second branch", _why(status, body))
        return

    token = api.login(email)
    if token is None:
        rep.bug("K", f"{code} · the branch cashier can sign in", email)
        return

    before_main = _stock_at(api, owner, pid, main["id"])
    before_second = _stock_at(api, owner, pid, second["id"])
    if before_main is None or before_second is None:
        return

    # The header names MAIN. The cashier belongs to the second branch.
    status, body = api.call("POST", "/sales", {
        "channel": "pos",
        "items": [{"product_id": pid, "quantity": 1}],
        "payment_method": "cash", "amount_paid": PRICE,
    }, token=token, headers={"X-Branch-Id": main["id"]})

    if status not in (200, 201):
        rep.query("K", f"{code} · the branch cashier can ring a sale", _why(status, body))
        return

    after_main = _stock_at(api, owner, pid, main["id"])
    after_second = _stock_at(api, owner, pid, second["id"])

    if abs(before_main - after_main) > 0.001:
        rep.bug("K", f"{code} · A HEADER CANNOT MOVE STAFF TO ANOTHER BRANCH",
                f"a cashier assigned to the second branch sold out of Main "
                f"({before_main:.0f} → {after_main:.0f}) by sending X-Branch-Id")
    elif abs(before_second - after_second - 1) > 0.001:
        rep.query("K", f"{code} · which shelf the branch cashier sold from",
                  f"Main {before_main:.0f}→{after_main:.0f}, "
                  f"second {before_second:.0f}→{after_second:.0f}")
    else:
        rep.ok("K", f"{code} · staff stay on their own branch",
               "header named Main; the sale came off the second branch")


# ── plumbing ───────────────────────────────────────────────────────────

def _branches(api: Api, rep: Report, code: str, token: str):
    status, body = api.get("/branches", token=token)
    rows = _rows(body) if status == 200 else []
    main = next((b for b in rows if b.get("is_default")), None)
    second = next((b for b in rows if b.get("name") == SECOND), None)

    if main is None:
        rep.bug("K", f"{code} · the shop has a Main branch", f"{len(rows)} branches")
        return None

    if second is None:
        status, body = api.post("/branches", {"name": SECOND, "code": "SWP2"}, token=token)
        if status not in (200, 201):
            rep.bug("K", f"{code} · open a second branch", _why(status, body))
            return None
        second = body.get("data") or {}
        rep.ok("K", f"{code} · second branch opened", SECOND)

    return main, second


def _set_stock(api: Api, token: str, pid: str, branch_id: str, qty: float) -> None:
    api.call("POST", "/inventory/adjust", {
        "product_id": pid, "type": "set", "new_quantity": qty, "reason": "QA sweep branch stock",
    }, token=token, headers={"X-Branch-Id": branch_id})


def _stock_at(api: Api, token: str, pid: str, branch_id: str) -> float | None:
    status, body = api.get(f"/products/{pid}/branch-stock", token=token)
    if status != 200:
        return None
    for r in _rows(body):
        if r.get("branch_id") == branch_id:
            return float(r.get("quantity") or 0)
    return None


def _valuation_qty(api: Api, token: str, pid: str, branch_id: str | None) -> float | None:
    headers = {"X-Branch-Id": branch_id} if branch_id else None
    status, body = api.call("GET", "/reports/valuation", None, token=token, headers=headers)
    if status != 200:
        return None
    # `{branch_scope, totals, by_category, items}` — the lines are under
    # `items`, not at the top level. The envelope again.
    for r in ((body.get("data") or {}).get("items") or []):
        if r.get("product_id") == pid or r.get("id") == pid:
            return float(r.get("quantity") or r.get("stock_quantity") or 0)
    return None


def _already(body: dict) -> bool:
    errs = body.get("errors") or {}
    text = " ".join(m for msgs in errs.values() for m in msgs).lower()
    return "already" in text or "taken" in text


def _why(status: int, body: dict) -> str:
    return f"{status} {body.get('errors') or body.get('message')}"


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
