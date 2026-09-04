"""
Phase V — nothing of mine is visible to anybody else.

Every phase before this one asks whether a shop can do its job. This one asks
the question a shopkeeper actually asks before they will type a customer's
phone number into somebody else's software:

    can the shop next door see any of this?

── Why it needed its own phase ─────────────────────────────────────────

Phase F already asked it, and asked it well — but five times, between ONE pair
of shops, about five kinds of record. The sweep builds nine shops and the API
has forty-six kinds of record addressable by id. Five of forty-six, between one
of thirty-six possible pairs, is not an answer about isolation; it is a sample
so small that a hole almost anywhere would pass it.

── How it gets its ids without knowing a single payload ────────────────

By ASKING THE VICTIM for them. Phases A–U have already filled every shop with
products, customers, suppliers, sales, expenses, staff and the rest, so each
list endpoint is read as its owner, the first id is taken, and that id is then
carried next door.

That is also why this phase runs last: it owns nothing and creates nothing. It
is a reader of other phases' leavings, which makes it cheap and makes it grow
on its own every time an earlier phase learns to build something new.

── Two questions per record, and the second is the one shops mean ──────

    1. can the intruder READ it by id?          → must not be 200
    2. does the intruder's OWN LIST contain it? → must not

The second is the one people picture when they worry about this: not somebody
guessing a UUID, but somebody's customer simply APPEARING in your list. A
global scope that is missing from one query answers (1) correctly and fails
(2), which is precisely the shape `where('tenant_id')` written by hand 187
times can take.

── What a refusal must look like ───────────────────────────────────────

404, and not 403.

403 says "this exists and you may not have it", which confirms the record to a
stranger. 404 says nothing at all. Both keep the data in, so a 403 is recorded
as a QUERY rather than a bug — it is a leak of existence, not of contents, and
worth seeing without stopping the run.
"""

from api import Api, Report

# ── the surface ────────────────────────────────────────────────────────
#
# `list` is read as the owner to find a real id; `item` is then asked for next
# door. A resource with no by-id GET still gets the list question, which is the
# more important half anyway.
#
# Names are the shop's words, not the route's, because that is what a finding
# has to be readable as.
#
# `None` means the resource has NO single-record GET — expenses, incomes and
# promotions are edited by id and never fetched by it. Asking anyway produced
# 405s that read like refusals and were really this table being wrong; the
# list question below is the one that matters for them, and it still runs.
# The module the INTRUDER must have for the question to reach the tenant fence
# at all. Without it they are turned away by `feature:` first, and a refusal
# that never reached the wall says nothing about the wall — see _neighbour().
NEEDS: dict[str, str] = {
    "a supplier": "purchasing",
    "a purchase order": "purchasing",
    "a stock count": "stocktake",
    "a disposal": "disposals",
    "a stock transfer": "inventory",
    "a coupon": "promotions",
    "a promotion": "promotions",
    "a quotation or layaway": "documents",
    "a dining table": "dine_in",
    "a fuel tank": "fuel",
    "a forecourt shift": "fuel",
    "an online order": "marketplace",
    "a vehicle": "services",
}

RESOURCES: list[tuple[str, str, str | None]] = [
    ("a product", "/products", "/products/{id}"),
    ("a customer", "/customers", "/customers/{id}"),
    ("a supplier", "/suppliers", "/suppliers/{id}"),
    ("a category", "/categories", "/categories/{id}"),
    ("a sale", "/sales", "/sales/{id}"),
    ("a purchase order", "/purchase-orders", "/purchase-orders/{id}"),
    ("an expense", "/expenses", None),
    ("an income", "/incomes", None),
    ("an expense category", "/expense-categories", None),
    ("an income category", "/income-categories", None),
    ("a bank", "/banks", None),
    ("a coupon", "/coupons", "/coupons/{id}"),
    ("a promotion", "/promotions", None),
    ("a customer group", "/customer-groups", None),
    ("a tax group", "/tax-groups", None),
    ("a branch", "/branches", None),
    ("a register", "/registers", None),
    ("a staff member", "/staff", "/staff/{id}"),
    ("a vehicle", "/vehicles", "/vehicles/{id}"),
    ("a quotation or layaway", "/sale-documents", "/sale-documents/{id}"),
    ("a stock count", "/inventory/counts", "/inventory/counts/{id}"),
    ("a disposal", "/inventory/disposals", None),
    ("a stock transfer", "/inventory/transfers", None),
    ("a dining table", "/restaurant/tables", "/restaurant/tables/{id}"),
    ("a fuel tank", "/fuel/tanks", None),
    ("a forecourt shift", "/fuel/shifts", "/fuel/shifts/{id}"),
    ("a till device", "/pos-devices", None),
    ("a trading day", "/pos/days", "/pos/days/{id}"),
    ("an online order", "/orders", "/orders/{id}"),
    ("the audit trail", "/audit-logs", None),
]


def _rows(body: dict) -> list[dict]:
    data = body.get("data")
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        for key in ("data", "items"):
            inner = data.get(key)
            if isinstance(inner, list):
                return [r for r in inner if isinstance(r, dict)]
    return []


def _first_id(api: Api, path: str, token: str) -> str | None:
    status, body = api.get(path, token=token)
    if status != 200:
        return None
    for row in _rows(body):
        if isinstance(row.get("id"), str):
            return row["id"]
    return None


def _neighbour(shops: list, i: int, module: str | None):
    """The next shop round the list that could actually reach this resource."""
    for step in range(1, len(shops)):
        code, state = shops[(i + step) % len(shops)]
        if module is None or (state.get("features") or {}).get(module):
            return code, state
    return None


def run(api: Api, rep: Report, sold: dict) -> dict:
    shops = [(code, state) for code, state in sold.items() if state.get("token")]

    if len(shops) < 2:
        rep.bug("V", "two shops to stand between", f"only {len(shops)} available")
        return sold

    # Every shop is the victim once, and the shop AFTER it in the list is the
    # intruder — so all nine take both parts and no pair is privileged. A full
    # 9×9 would be eight times the requests for the same answer; what matters
    # is that no shop is only ever the one being protected.
    asked = 0
    unasked: list[str] = []

    for i, (code, state) in enumerate(shops):
        victim = state["token"]

        for label, list_path, item_path in RESOURCES:
            rid = _first_id(api, list_path, victim)
            if rid is None:
                continue  # this shop has none of these; nothing to protect

            # ── PICK AN INTRUDER WHO WOULD OTHERWISE BE LET IN ───────────
            #
            # The first version simply took the next shop in the list, and
            # eleven pairs then answered 403 — the intruder's own `feature:`
            # gate, fired long before the tenant fence was consulted. Those
            # read as weak refusals and were really QUESTIONS NEVER ASKED, on
            # a run whose whole subject is telling those two apart.
            #
            # So the neighbour is chosen: the next shop round the list that
            # HAS whatever module this record sits behind. Where no such shop
            # exists — only one trade is given `fuel` — the pair is recorded
            # as unasked rather than dressed up as a pass.
            neighbour = _neighbour(shops, i, NEEDS.get(label))
            if neighbour is None:
                unasked.append(f"{code}'s {label}")
                continue

            neighbour_code, intruder = neighbour[0], neighbour[1]["token"]

            asked += 1
            what = f"{neighbour_code} vs {code}'s {label}"

            # 1 · reading it by id
            if item_path is not None:
                status, _ = api.get(item_path.format(id=rid), token=intruder)
                if status in (200, 201):
                    rep.bug("V", f"THE WALL IS DOWN — {what}", f"read {list_path}/{rid} and got 200")
                elif status == 403:
                    rep.query("V", f"{what} — refused with 403, not 404",
                              "403 confirms the record exists to a stranger; 404 says nothing")
                elif status != 404:
                    rep.query("V", f"{what} — refused with {status}", "expected 404")
                else:
                    rep.ok("V", f"{what} · not readable by id", "404")

            # 2 · finding it in their OWN list — the one shops actually picture
            status, body = api.get(list_path, token=intruder)
            if status == 200:
                theirs = {r.get("id") for r in _rows(body)}
                if rid in theirs:
                    rep.bug("V", f"THE WALL IS DOWN — {what} IN THEIR OWN LIST",
                            f"{list_path} returned another shop's row")
                else:
                    rep.ok("V", f"{what} · absent from their list")

    # Said out loud rather than left as a silent gap: a record only ONE trade is
    # given has no second shop to be hidden from, so the wall cannot be tested
    # there by this method at all.
    if unasked:
        rep.query("V", "records no other shop could even ask for",
                  ", ".join(sorted(set(unasked))[:8]) + (" …" if len(set(unasked)) > 8 else ""))

    # THE DENOMINATOR. This phase reads other phases' leavings, so a run where
    # those phases built nothing would ask nothing and pass in silence — which
    # is the one way a wall test can lie.
    if asked < 40:
        rep.bug("V", "TOO LITTLE WAS ASKED", f"only {asked} (shop, record) pairs had anything to test")
    else:
        rep.ok("V", "the wall was tested", f"{asked} (shop, record) pairs across {len(shops)} shops")

    return sold
