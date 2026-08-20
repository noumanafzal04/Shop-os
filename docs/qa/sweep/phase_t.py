"""
Phase T — who changed what.

A shop's audit trail recorded who may DO things and said nothing about what
those things are WORTH. Eight sensitive actions driven through the API left
three records between them:

    the discount ceiling on a cashier's discretion     recorded
    a staff permission                                  recorded
    suspending a member of staff                        recorded
    a customer's credit limit, 5,000 → 90,000           NOTHING
    a tax rate, which re-rates every product on it      NOTHING
    a customer group's discount, every member at once   NOTHING
    a coupon, money off every bill that quotes it       NOTHING

Every line in the second half is a money authority, and every line in the first
is proof the shop already believed such things were worth recording.

And nobody in the shop could read any of it. The only way in was
`/admin/audit-logs`, behind `role:super_admin` — an owner saw eight rows on
their dashboard and could ask nothing of them, while the Help Centre told them,
correctly, that the log records who did what.

Three questions:

    RECORDED    an act that grants money authority leaves a row, with the
                actor's name and the value it had before
    QUIET       an act that does not — a phone number corrected at the counter
                — leaves nothing. A trail that records everything is a trail
                nobody reads to the bottom of
    READABLE    by the shop it is about, and not by a cashier, and never by
                another shop

── Why the last one needs two shops ────────────────────────────────────

`AuditLog` carries a `tenant_id` and is deliberately NOT tenant-scoped as a
model: the platform reads across every shop. So the tenant endpoint's `where`
is the only thing standing between one shop and another's history, and a check
with one shop cannot see it at all.
"""

from api import Api, Report

PROBE = "Sweep Audit Probe"


def run(api: Api, rep: Report, sold: dict) -> dict:
    codes = list(sold)

    for code, state in sold.items():
        token = state["token"]

        _a_credit_limit_names_who_raised_it(api, rep, code, token)
        _a_walk_in_customer_is_not_an_event(api, rep, code, token)
        _a_coupon_names_who_made_it(api, rep, code, token, state)
        _a_tax_rate_names_who_moved_it(api, rep, code, token, state)
        _the_shop_can_ask_its_own_trail_a_question(api, rep, code, token)
        _a_cashier_cannot_read_it(api, rep, code, token, state)
        _one_shop_never_sees_another(api, rep, code, token, sold, codes)

    return sold


# ── recorded ───────────────────────────────────────────────────────────

def _a_credit_limit_names_who_raised_it(api: Api, rep: Report, code: str, token: str) -> None:
    """
    The sharpest of them. A credit limit decides how much this person may walk
    out with unpaid — the same class of act as granting a permission, and
    permissions have always been recorded.
    """
    customer = _customer(api, token, f"{PROBE} Credit", credit=5000)
    if customer is None:
        rep.query("T", f"{code} · a customer to give credit to", "could not create one")
        return

    status, _ = api.patch(f"/customers/{customer['id']}", {"credit_limit": 90000}, token=token)
    if status != 200:
        rep.query("T", f"{code} · raise a credit limit", f"{status}")
        return

    row = _latest(api, token, "Customer")

    if row is None:
        rep.bug("T", f"{code} · A CREDIT LIMIT WAS RAISED WITH NOBODY NAMED",
                "5,000 → 90,000 and the trail has no row for it")
        return

    # The row has to carry the OLD figure. "It is 90,000 now" is on the customer
    # record already; what a trail adds is what it was before.
    old = str((row.get("old_values") or {}).get("credit_limit"))
    if old.startswith("5000"):
        rep.ok("T", f"{code} · the trail says what the limit WAS", "5,000")
    else:
        rep.bug("T", f"{code} · THE TRAIL DOES NOT SAY WHAT THE LIMIT WAS",
                f"'it is 90,000 now' is on the customer record already; old_values={row.get('old_values')}")

    if (row.get("actor") or {}).get("name"):
        rep.ok("T", f"{code} · and who raised it", row["actor"]["name"])
    else:
        rep.bug("T", f"{code} · A CREDIT LIMIT WAS RAISED WITH NOBODY NAMED",
                f"a row with no actor answers nothing; actor={row.get('actor')}")


def _a_coupon_names_who_made_it(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    A coupon sits DELIBERATELY outside the discount ceiling — the ceiling caps
    what a cashier decides on the spot, and a coupon is a decision the shop
    already made — so the ceiling's own trail says nothing about it.
    """
    if not (state.get("features") or {}).get("pos"):
        return

    status, body = api.post("/coupons", {
        "code": f"SWEEPAUDIT{abs(hash(code)) % 997}", "type": "percent", "value": 50,
    }, token=token)

    if status not in (200, 201):
        # Already there from an earlier run: nothing was created, so nothing
        # should have been recorded, and this check has no subject.
        rep.ok("T", f"{code} · coupon already exists", "no new row expected")
        return

    row = _latest(api, token, "Coupon")

    if row is None or row.get("event") != "created":
        rep.bug("T", f"{code} · A COUPON WAS MADE WITH NOBODY NAMED",
                "50% off every bill that quotes it, and no row")
        return

    rep.ok("T", f"{code} · a coupon names who made it", (row.get("actor") or {}).get("name") or "?")


def _a_tax_rate_names_who_moved_it(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    The model's own docblock: "edit the rate once and every product on it
    re-rates". The difference between the old rate and the new one is money
    owed to FBR.
    """
    status, body = api.get("/tax-groups", token=token)
    groups = _rows(body) if status == 200 else []

    group = next((g for g in groups if g.get("name") == PROBE), None)
    if group is None:
        status, body = api.post("/tax-groups", {"name": PROBE, "rate": 17}, token=token)
        if status not in (200, 201):
            rep.ok("T", f"{code} · no tax groups here", f"{status} — nothing to move")
            return
        group = body.get("data") or {}

    was = float(group.get("rate") or 0)
    now = 5.0 if was != 5.0 else 12.0

    status, _ = api.put(f"/tax-groups/{group['id']}", {"name": PROBE, "rate": now}, token=token)
    if status != 200:
        rep.query("T", f"{code} · move a tax rate", f"{status}")
        return

    row = _latest(api, token, "TaxGroup")

    if row is None:
        rep.bug("T", f"{code} · A TAX RATE WAS MOVED WITH NOBODY NAMED",
                f"{was}% → {now}%, and every product on the group re-rated")
        return

    rep.ok("T", f"{code} · a tax rate names who moved it", f"{was}% → {now}%")


# ── quiet ──────────────────────────────────────────────────────────────

def _a_walk_in_customer_is_not_an_event(api: Api, rep: Report, code: str, token: str) -> None:
    """
    A shop keys hundreds of these. Recording every one buries the line that
    matters, which is the whole argument for auditing this model in ONE respect
    rather than entire.
    """
    before = _latest(api, token, "Customer")

    customer = _customer(api, token, f"{PROBE} Walk In", credit=None)
    if customer is None:
        return

    after = _latest(api, token, "Customer")
    same = (before or {}).get("id") == (after or {}).get("id")

    rep.expect("T", f"{code} · a walk-in customer is not an event", same, True,
               f"a customer with no credit limit filed {after and after.get('event')}")


# ── readable ───────────────────────────────────────────────────────────

def _the_shop_can_ask_its_own_trail_a_question(api: Api, rep: Report, code: str, token: str) -> None:
    """
    Eight rows on a dashboard is not a record. A record can be asked a
    question — this kind of thing, that week.
    """
    status, body = api.get("/audit-logs?type=Customer&per_page=50", token=token)

    if status != 200:
        rep.bug("T", f"{code} · THE SHOP CANNOT READ ITS OWN TRAIL", f"GET /audit-logs → {status}")
        return

    rows = _rows(body)
    wrong = [r["entity"] for r in rows if r.get("entity") != "Customer"]

    rep.expect("T", f"{code} · the trail can be asked for one kind of thing",
               len(wrong), 0, f"asked for Customer, got {sorted(set(wrong))}")
    rep.expect("T", f"{code} · and answers with rows", len(rows) > 0, True)


def _a_cashier_cannot_read_it(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    Deliberate in both directions. The person most often being ASKED about is
    the one holding settings.manage, so gating the read on that permission
    alone would be the `*.manage` bug again — but a cashier holds neither it
    nor reports.view, and must not.
    """
    cashier = state.get("staff", {}).get("cashier") if isinstance(state.get("staff"), dict) else None
    cashier = cashier or api.login(f"sweep-{code.replace('_', '_')}-cashier@qa.test")

    if not cashier:
        rep.ok("T", f"{code} · no cashier here", "nothing to refuse")
        return

    status, _ = api.get("/audit-logs", token=cashier)

    if status == 403:
        rep.ok("T", f"{code} · a cashier is refused the trail")
    elif status == 200:
        rep.bug("T", f"{code} · A CASHIER CAN READ WHO CHANGED WHAT",
                "the trail names the people who set the shop's rules, and it is "
                "gated on being one of them")
    else:
        rep.query("T", f"{code} · a cashier is refused the trail",
                  f"got {status}, expected 403 — refused for the wrong reason proves nothing")


def _one_shop_never_sees_another(api: Api, rep: Report, code: str, token: str,
                                 sold: dict, codes: list) -> None:
    """
    `AuditLog` is NOT tenant-scoped as a model — the platform reads across every
    shop — so the endpoint's own `where` is the only wall. A check with one shop
    cannot see that wall at all.
    """
    other = next((c for c in codes if c != code), None)
    if other is None:
        rep.query("T", f"{code} · a second shop to be walled off from", "only one shop in this run")
        return

    status, body = api.get("/audit-logs?per_page=100", token=token)
    if status != 200:
        return
    mine = {r["id"] for r in _rows(body)}

    status, body = api.get("/audit-logs?per_page=100", token=sold[other]["token"])
    if status != 200:
        return
    theirs = {r["id"] for r in _rows(body)}

    if not mine or not theirs:
        rep.query("T", f"{code} · both shops have a trail", "one of them is empty — nothing to leak")
        return

    shared = mine & theirs

    if shared:
        rep.bug("T", f"{code} · ONE SHOP CAN SEE ANOTHER SHOP'S HISTORY",
                f"{len(shared)} row(s) appear in both {code} and {other}")
    else:
        rep.ok("T", f"{code} · no row is shared with {other}")


# ── helpers ────────────────────────────────────────────────────────────

def _customer(api: Api, token: str, name: str, credit: float | None) -> dict | None:
    body = {"name": name, "phone": f"0300{abs(hash(name)) % 10000000:07d}"}
    if credit is not None:
        body["credit_limit"] = credit

    status, payload = api.post("/customers", body, token=token)
    if status in (200, 201):
        return payload.get("data") or {}

    # Left over from an earlier run — reuse it, and put the limit back so the
    # raise below is a real change rather than a no-op the trail rightly ignores.
    status, payload = api.get(f"/customers?search={name.replace(' ', '+')}", token=token)
    found = next((c for c in _rows(payload) if c.get("name") == name), None)
    if found and credit is not None:
        api.patch(f"/customers/{found['id']}", {"credit_limit": credit}, token=token)

    return found


def _latest(api: Api, token: str, entity: str) -> dict | None:
    status, body = api.get(f"/audit-logs?type={entity}&per_page=1", token=token)
    rows = _rows(body) if status == 200 else []

    return rows[0] if rows else None


def _rows(body: dict) -> list:
    data = body.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("data") or []
    return []
