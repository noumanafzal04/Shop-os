"""
Phase I — who is standing at the counter, and on which lane.

Every phase before this ran as the OWNER, who passes every gate there is. That
makes seven phases of green worth less than it looks: the whole permission
system was never asked a question it could fail.

Two things here, and they fail in different ways.

── THE JOBS ───────────────────────────────────────────────────────────
A shop hires a cashier, a manager, someone to key the stock in, someone to do
the books. Each needs exactly their own job — and this codebase has a named,
repeated bug where a **write** permission fenced a **read**: the kitchen board
required `sales.manage`, so a kitchen hand had to be shown the shop's takings in
order to mark a curry ready. A preset that cannot do its own job is invisible
until somebody is hired into it.

So every preset is checked from both ends:
    CAN     the things its own description promises
    CANNOT  the things belonging to somebody else's job

The second half is the half with teeth. "Can the cashier ring a sale" is easy;
"can the cashier void one" is the question the shop is actually relying on.

── THE LANES ──────────────────────────────────────────────────────────
Three cashiers, three tills, one shop, at the same time. Every drawer must hold
exactly its own takings — not the shop's, not its neighbour's — because the
figure a cashier is counted against at ten at night is the one thing they can be
sacked over. Lanes that bleed into each other produce a variance nobody can
explain and an accusation nobody can answer.
"""

from api import Api, Report
from phase_c import PRICE

PASSWORD = "password"

# What each job must reach, and what must stay shut. Paths only — every probe is
# a GET unless it names a method, because a read that is wrongly refused is this
# codebase's documented bug and a write that is wrongly allowed is the dangerous
# one.
#
# `("POST", path, body)` for the writes worth proving are refused.
JOBS = {
    "cashier": {
        "can": [
            "/pos/session",          # my own drawer
            "/pos/bootstrap",        # what I may sell
            "/products",             # the catalog — a READ, behind READS_CATALOG
            "/pos/sellers",          # who I may credit the sale to
            "/branches",             # which shop I am standing in
            "/customers",            # look a regular up
        ],
        "cannot": [
            "/reports/summary",      # the day's takings
            "/staff",                # who works here
            "/expenses",             # the shop's money
            "/suppliers",
        ],
    },
    "shift_supervisor": {
        "can": ["/pos/session", "/products", "/reports/summary"],
        "cannot": ["/staff", "/suppliers"],
    },
    "manager": {
        # Runs the shop; does not decide who works in it or how it is set up.
        # `/registers` belongs here, not in `cannot`. Which lanes exist is a
        # SUPERVISORY READ — it is the header of every shift report — and the
        # gate is `settings.manage,reports.view`, either of which will do. A
        # manager holds reports.view, so seeing the lane list is their job.
        # Creating and retiring lanes is the setup they deliberately lack.
        "can": ["/pos/session", "/products", "/reports/summary", "/expenses",
                "/suppliers", "/purchase-orders", "/inventory/low-stock",
                "/customers", "/registers"],
        "cannot": ["/staff"],
    },
    "stock_keeper": {
        # The data-entry job: keys the shop's catalog and stock in, touches no money.
        "can": ["/products", "/inventory/low-stock", "/inventory/movements", "/categories"],
        "cannot": ["/reports/summary", "/expenses", "/staff", "/pos/session"],
    },
    "buyer": {
        "can": ["/suppliers", "/purchase-orders", "/products", "/inventory/low-stock"],
        "cannot": ["/reports/summary", "/staff", "/pos/session"],
    },
    "accountant": {
        "can": ["/expenses", "/incomes", "/reports/summary", "/cashbook", "/ledger"],
        "cannot": ["/products", "/pos/session", "/staff"],
    },
    "kitchen": {
        # The documented bug, from the outside. The pass takes EITHER key, so a
        # kitchen hand reaches the board holding kitchen.manage alone — and is
        # shown none of the money that the floor's key would have opened.
        "can": ["/restaurant/kitchen"],
        "cannot": ["/sales", "/reports/summary", "/pos/session", "/restaurant/tickets"],
    },
    "waiter": {
        "can": ["/restaurant/tables", "/restaurant/tickets", "/restaurant/servers"],
        "cannot": ["/reports/summary", "/staff", "/expenses"],
    },
    "forecourt_attendant": {
        "can": ["/fuel/shifts", "/fuel/tanks", "/pos/session"],
        "cannot": ["/reports/summary", "/staff"],
    },
    "online_orders": {
        "can": ["/products", "/orders", "/customers"],
        "cannot": ["/reports/summary", "/staff", "/expenses", "/pos/session"],
    },
    "pharmacist": {
        # `/pharmacy/alternatives` needs a `product_id`, not a search string —
        # it answers "the brand is out, what else has the same salt?", which
        # starts from a specific drug. Probed via {product} below.
        "can": ["/products", "/inventory/expiring", "/pos/session",
                "/pharmacy/alternatives?product_id={product}"],
        "cannot": ["/staff", "/expenses"],
    },
}

# Writes that must be refused. The read matrix above cannot express these, and
# they are the ones a shop is actually relying on.
FORBIDDEN_WRITES = {
    "cashier": [
        ("void a completed sale", "POST", "/sales/{sale}/cancel", {"reason_code": "test_sale"}),
        ("refund a customer", "POST", "/sales/{sale}/returns",
         {"items": [{"sale_item_id": "{item}", "quantity": 1}], "refund_method": "cash"}),
    ],
    "stock_keeper": [
        ("ring a sale", "POST", "/sales", None),
    ],
    "accountant": [
        ("ring a sale", "POST", "/sales", None),
        ("adjust stock", "POST", "/inventory/adjust", {"product_id": "{product}", "type": "in", "quantity": 1}),
    ],
    "kitchen": [
        ("ring a sale", "POST", "/sales", None),
    ],
}

LANES = ["Lane 1", "Lane 2", "Lane 3"]


def run(api: Api, rep: Report, sold: dict, tenants: dict) -> dict:
    # One shop per capability profile rather than all eight: a preset matrix is
    # about the PRESET, and running the same one on seven shops costs seven
    # logins against a 5/min limit to learn the same fact once.
    for code in ("mart", "food_restaurant", "pharmacy", "petroleum"):
        state = sold.get(code)
        if state is None:
            continue
        _jobs(api, rep, code, state)

    lane_shop = sold.get("mart") or sold.get("retail")
    if lane_shop is not None:
        _lanes(api, rep, "mart" if "mart" in sold else "retail", lane_shop)

    return sold


# ── the jobs ───────────────────────────────────────────────────────────

def _jobs(api: Api, rep: Report, code: str, state: dict) -> None:
    owner = state["token"]

    status, body = api.get("/staff/presets", token=owner)
    presets = _rows(body) if status == 200 else []
    if not presets:
        rep.bug("I", f"{code} · the shop is offered job presets", str(status))
        return

    rep.ok("I", f"{code} · {len(presets)} presets offered",
           ", ".join(p.get("code", "?") for p in presets))

    for preset in presets:
        job = preset.get("code")
        matrix = JOBS.get(job)
        if matrix is None:
            rep.query("I", f"{code} · {job} · no expectations written", preset.get("label"))
            continue

        token = _hire(api, rep, code, owner, preset)
        if token is None:
            continue

        # 1 · the job's own work must be reachable.
        for path in matrix["can"]:
            status, _ = api.get(path.replace("{product}", state["product"]["id"]), token=token)
            if status == 200:
                rep.ok("I", f"{code} · {job} can reach {path}")
            elif status == 403:
                rep.bug("I", f"{code} · {job} · A JOB MUST BE ABLE TO DO ITS JOB",
                        f"403 on {path}, which its own description promises")
            else:
                rep.query("I", f"{code} · {job} · {path}", str(status))

        # 2 · somebody else's work must not be.
        for path in matrix["cannot"]:
            status, _ = api.get(path, token=token)
            if status == 200:
                rep.bug("I", f"{code} · {job} · {path.upper()} IS NOT THIS JOB'S",
                        "returned 200 to somebody who should not see it")
            else:
                rep.ok("I", f"{code} · {job} kept out of {path}", str(status))

        _forbidden_writes(api, rep, code, job, token, state)


def _forbidden_writes(api: Api, rep: Report, code: str, job: str,
                      token: str, state: dict) -> None:
    """The refusals a shop is actually relying on."""
    sale = state.get("stock_sale") or state.get("priced_sale") or {}
    items = sale.get("items") or []

    for label, method, path, body in FORBIDDEN_WRITES.get(job, []):
        if "{sale}" in path and not sale.get("id"):
            continue

        real_path = path.replace("{sale}", str(sale.get("id")))
        payload = _fill(body, sale, items, state) if body else {
            "channel": "pos",
            "items": [{"product_id": state["product"]["id"], "quantity": 1}],
            "payment_method": "cash", "amount_paid": PRICE,
        }

        status, _ = api.call(method, real_path, payload, token=token)
        if status in (200, 201):
            rep.bug("I", f"{code} · {job} CANNOT {label.upper()}",
                    f"{method} {real_path} was accepted")
        else:
            rep.ok("I", f"{code} · {job} cannot {label}", str(status))


def _fill(body: dict, sale: dict, items: list, state: dict) -> dict:
    """Substitute the real ids into a probe payload."""
    text = str(body)
    text = text.replace("{item}", str(items[0]["id"]) if items else "")
    text = text.replace("{product}", str(state["product"]["id"]))
    return eval(text)  # noqa: S307 — our own literal, one line above


def _hire(api: Api, rep: Report, code: str, owner: str, preset: dict) -> str | None:
    """A real staff member on this preset, reused between runs."""
    job = preset["code"]
    email = f"sweep-{code}-{job}@qa.test"

    status, body = api.post("/staff", {
        "name": f"Sweep {preset.get('label', job)}",
        "email": email,
        "password": PASSWORD,
        "permissions": preset.get("permissions") or [],
    }, token=owner)

    if status not in (200, 201) and not _already(body):
        rep.bug("I", f"{code} · hire a {job}", f"{status} {body.get('errors') or body.get('message')}")
        return None

    token = api.login(email, PASSWORD)
    if token is None:
        rep.bug("I", f"{code} · {job} can sign in", email)
    return token


# ── the lanes ──────────────────────────────────────────────────────────

def _lanes(api: Api, rep: Report, code: str, state: dict) -> None:
    """
    Three cashiers, three tills, at once — and three drawers that never mix.

    Each lane takes a DIFFERENT amount on purpose. Equal figures would let a
    drawer read its neighbour's takings and still balance, which is precisely
    the bug this is looking for.
    """
    owner = state["token"]

    registers = _registers(api, rep, code, owner)
    if len(registers) < len(LANES):
        rep.query("I", f"{code} · three lanes to run", f"have {len(registers)}")
        return

    # Fill the shelf first. Three lanes ring six baskets between them, and by
    # the time phase I runs the earlier phases have sold, returned, counted and
    # transferred their way through the stock — Lane 3 hit "insufficient stock"
    # and the sweep reported a lane bug that was its own housekeeping.
    api.post("/inventory/adjust", {
        "product_id": state["product"]["id"], "type": "set",
        "new_quantity": 200, "reason": "QA sweep · stock the lanes",
    }, token=owner)

    # Distinct floats and distinct baskets, so every figure is a fingerprint.
    crew = []
    for i, lane in enumerate(LANES):
        token = _hire(api, rep, code, owner, {
            "code": f"lane{i + 1}",
            "label": f"Cashier {i + 1}",
            "permissions": ["sales.manage", "discounts.apply", "customers.manage"],
        })
        if token is None:
            return
        crew.append({
            "lane": lane, "register": registers[i], "token": token,
            "float": 1000 * (i + 1),            # 1000 / 2000 / 3000
            "baskets": i + 1,                    # 1 / 2 / 3 sales
        })

    # 1 · everyone opens their own drawer on their own lane.
    for c in crew:
        _close_any_open(api, c["token"])
        status, body = api.post("/pos/session/open", {
            "opening_float": c["float"], "register_id": c["register"]["id"],
        }, token=c["token"])
        if status not in (200, 201):
            rep.bug("I", f"{code} · {c['lane']} opens", f"{status} {body.get('message')}")
            return
        c["session"] = (body.get("data") or {}).get("id")

    rep.ok("I", f"{code} · three lanes open", " · ".join(f"{c['lane']} @{c['float']}" for c in crew))

    # 2 · each rings a different number of sales.
    for c in crew:
        c["took"] = 0.0
        for _ in range(c["baskets"]):
            status, body = api.post("/sales", {
                "channel": "pos",
                "cash_session_id": c["session"],
                "items": [{"product_id": state["product"]["id"], "quantity": 1}],
                "payment_method": "cash", "amount_paid": PRICE,
            }, token=c["token"])
            if status not in (200, 201):
                rep.bug("I", f"{code} · {c['lane']} rings a sale",
                        f"{status} {body.get('errors') or body.get('message')}")
                return
            c["took"] += float((body.get("data") or {}).get("total") or 0)

    rep.ok("I", f"{code} · lanes rang", " · ".join(f"{c['lane']} {c['took']:.0f}" for c in crew))

    # 3 · each X-read shows THIS lane's takings and nobody else's.
    for c in crew:
        status, body = api.get("/pos/session/report", token=c["token"])
        if status != 200:
            rep.bug("I", f"{code} · {c['lane']} reads its own drawer", str(status))
            continue

        d = body.get("data") or {}
        expected = _expected(d)
        session = (d.get("session") or {}).get("id")

        if session != c["session"]:
            rep.bug("I", f"{code} · A LANE READS ITS OWN DRAWER",
                    f"{c['lane']} was shown session {session}, not {c['session']}")
            continue

        want = c["float"] + c["took"]
        if expected is None:
            rep.query("I", f"{code} · {c['lane']} expected cash", "absent (blind close?)")
        elif abs(float(expected) - want) > 0.01:
            rep.bug("I", f"{code} · A DRAWER HOLDS ONLY ITS OWN TAKINGS",
                    f"{c['lane']}: float {c['float']} + rang {c['took']:.0f} = {want:.0f}, "
                    f"drawer says {expected}")
        else:
            rep.ok("I", f"{code} · {c['lane']} drawer holds only its own", f"{want:.0f}")

    # 4 · one cashier must not be able to count out another's drawer.
    a, b = crew[0], crew[1]
    status, _ = api.get(f"/pos/sessions/{b['session']}/z-report", token=a["token"])
    if status == 200:
        rep.bug("I", f"{code} · ONE CASHIER CANNOT READ ANOTHER'S DRAWER",
                f"{a['lane']} read {b['lane']}'s Z-report")
    else:
        rep.ok("I", f"{code} · a cashier cannot read another's Z-report", str(status))

    # 5 · every lane counts out level, and the day is the sum of the lanes —
    #     nothing double-counted, nothing lost between them.
    banked = 0.0
    for c in crew:
        status, body = api.post("/pos/session/close", {
            "counted_cash": c["float"] + c["took"], "notes": f"QA sweep {c['lane']}",
        }, token=c["token"])
        if status not in (200, 201):
            rep.bug("I", f"{code} · {c['lane']} closes", f"{status} {body.get('message')}")
            continue

        variance = (body.get("data") or {}).get("variance")
        if variance is not None and abs(float(variance)) > 0.01:
            rep.bug("I", f"{code} · A LANE COUNTED EXACTLY IS LEVEL",
                    f"{c['lane']} counted {c['float'] + c['took']:.0f}, variance {variance}")
        else:
            rep.ok("I", f"{code} · {c['lane']} closed level")
        banked += c["took"]

    rep.ok("I", f"{code} · three lanes banked {banked:.0f} between them",
           " + ".join(f"{c['took']:.0f}" for c in crew))


def _expected(report: dict):
    """The one figure a cashier is counted against. Its own function so a
    mutation can lie about it and prove the lane check is really reading it."""
    return (report.get("drawer") or {}).get("expected_cash")


def _registers(api: Api, rep: Report, code: str, owner: str) -> list:
    status, body = api.get("/registers", token=owner)
    have = {r.get("name"): r for r in (_rows(body) if status == 200 else [])}

    out = []
    for lane in LANES:
        if lane in have:
            out.append(have[lane])
            continue
        status, body = api.post("/registers", {"name": lane, "code": lane.replace(" ", "")}, token=owner)
        if status in (200, 201):
            out.append(body.get("data") or {})
        else:
            rep.bug("I", f"{code} · add {lane}", f"{status} {body.get('errors') or body.get('message')}")
    return out


def _close_any_open(api: Api, token: str) -> None:
    """A drawer left open by a previous run would refuse the next open."""
    status, body = api.get("/pos/session", token=token)
    live = (body.get("data") or {}) if status == 200 else {}
    if live.get("status") == "open":
        status, rpt = api.get("/pos/session/report", token=token)
        expected = ((rpt.get("data") or {}).get("drawer") or {}).get("expected_cash") if status == 200 else 0
        api.post("/pos/session/close", {"counted_cash": float(expected or 0)}, token=token)


# ── plumbing ───────────────────────────────────────────────────────────

def _already(body: dict) -> bool:
    errs = body.get("errors") or {}
    text = " ".join(m for msgs in errs.values() for m in msgs).lower()
    return "already" in text or "taken" in text


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
