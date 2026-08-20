"""
Phase S — the shelf that ages.

Stock can be dated two ways and the difference is the whole subject.

    AN EXPIRY is a FENCE. A medicine past it may not be dispensed, and the
    platform blocks it. It had a shop-wide worklist, a dashboard tile, a counter
    warning, a morning notification and a place in FEFO.

    AN AGE is a HINT. Four digits on a tyre's sidewall — 2224 is week 22 of 2024
    — and rubber ages sitting still whether or not anyone drives on it. Nothing
    becomes illegal on a date, so nothing may ever be blocked. It had a badge
    inside one product's batch drawer.

Which is to say: the shop was asked to write a manufacture date down, and almost
nothing read it back. `ProductBatch::scopeAgedBeyond` existed with zero callers,
`near_expiry` is permanently null for a tyre, and depletion sorted on expiry
alone — so every undated lot tied and the pallet that arrived on Tuesday went
out while the 2019 set aged quietly behind it.

Four claims, and the first is the one with money in it:

    OLDEST FIRST   selling takes the oldest lot on the shelf, measured from
                   manufacture when there is no expiry to measure from
    UNKNOWN LAST   a lot nobody dated is neither new nor ancient; it waits
    TOLD           the counter is told, by name, which lot it is handing over
    NEVER FENCED   and it sells anyway, because that was always the point

Not gated on a trade. `stock_age_warn_years` is a shop setting, `dot_code` is
accepted on any lot, and `/inventory/ageing` asks the shop rather than the
trade — so every shop with the inventory module gets asked these questions.
A trade list here would be a second copy of an answer the product already has.
"""

from api import Api, Report

# Old enough to be past every default (five years to ageing, six to old) with
# room to spare, and a fresh lot that no threshold could mistake for either.
OLD_MONTHS = 96
MID_MONTHS = 78
FRESH_MONTHS = 3
LOT_QTY = 6.0

SHELF = "Sweep Shelf Lot"


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code, state in sold.items():
        if not (state.get("features") or {}).get("inventory"):
            rep.ok("S", f"{code} · no stock module", "skipped, correctly")
            continue

        token = state["token"]

        # A medicine lot MUST carry an expiry — the server refuses one without,
        # and that refusal is a feature. So a pharmacy's question is the expiry
        # sweep, not this one, and saying so out loud is better than a silent
        # `continue` that leaves a hole in the denominator.
        item_type = _ageable_type(state.get("item_types") or [])
        if item_type is None:
            rep.ok("S", f"{code} · nothing here is dated by manufacture",
                   f"item_types={state.get('item_types')}")
            continue

        product = _shelf_item(api, rep, code, token, item_type)
        if product is None:
            rep.query("S", f"{code} · a product to put lots on", "could not create one — nothing below ran")
            continue

        pid = product["id"]

        _a_lot_remembers_the_week_it_was_made(api, rep, code, token, pid)
        _the_oldest_lot_leaves_first(api, rep, code, token, pid)
        _a_lot_nobody_dated_waits_its_turn(api, rep, code, token, pid)
        _the_counter_is_told_which_lot_it_is_handing_over(api, rep, code, token, pid, product)
        _a_fresh_lot_says_nothing_at_the_counter(api, rep, code, token, pid, product)
        _the_shelf_can_be_swept_in_one_question(api, rep, code, token, pid)
        _a_stricter_question_can_be_asked_of_the_same_shelf(api, rep, code, token, pid)
        _an_old_lot_is_still_sold(api, rep, code, token, pid)

    return sold


# ── the date itself ────────────────────────────────────────────────────

def _a_lot_remembers_the_week_it_was_made(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """Four digits in, an age out — and the shop never updates it again."""
    _clear(api, rep, code, token, pid)

    lot = _lot(api, token, pid, "SWEEP-DOT", dot="2218")
    if lot is None:
        rep.query("S", f"{code} · a sidewall code is accepted", "the lot was refused")
        return

    row = _row(api, token, pid, "SWEEP-DOT")
    if row is None:
        rep.bug("S", f"{code} · the lot came back", "created, then absent from the list")
        return

    # 2218 = week 22 of 2018. The AGE is computed, never stored, because it
    # changes every day on its own — so the check is that it is a real age, not
    # that it equals a number this file guessed.
    got = (row.get("manufactured_on") or "")[:4]
    rep.expect("S", f"{code} · a sidewall code becomes a date", got, "2018",
               f"dot 2218 → manufactured_on {row.get('manufactured_on')}")
    rep.expect("S", f"{code} · the shop is told how old the lot is",
               bool(row.get("age")) and row.get("age_status") in ("ageing", "old"),
               True, f"age={row.get('age')} status={row.get('age_status')}")

    # A typo must read as "no date", never as a date in 1970.
    status, _ = api.post(f"/inventory/products/{pid}/batches",
                         {"batch_number": "SWEEP-BADDOT", "dot_code": "22-18", "quantity": 1}, token=token)
    rep.expect("S", f"{code} · a mistyped sidewall code is refused", status, 422)


# ── oldest first ───────────────────────────────────────────────────────

def _the_oldest_lot_leaves_first(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    The claim with money in it.

    The FRESH lot is created first on purpose. Insertion order already gives the
    wrong answer, so a pass here has to be the ordering doing work rather than
    the database agreeing by luck — which is exactly how this went unnoticed:
    a shop that receives stock and sells it in the order it arrived looks fine
    until the day it doesn't.
    """
    _clear(api, rep, code, token, pid)

    fresh = _lot(api, token, pid, "SWEEP-NEW", months=FRESH_MONTHS)
    old = _lot(api, token, pid, "SWEEP-OLD", months=OLD_MONTHS)
    if fresh is None or old is None:
        rep.query("S", f"{code} · two lots to choose between", "could not create both")
        return

    if not _sell(api, token, pid, LOT_QTY):
        rep.query("S", f"{code} · a sale to deplete a lot", "the sale was refused")
        return

    left_old = _left(api, token, pid, "SWEEP-OLD")
    left_fresh = _left(api, token, pid, "SWEEP-NEW")

    _claim(rep, code, left_old == 0.0,
           "the oldest lot is the one that left", "THE OLDEST LOT DID NOT LEAVE FIRST",
           f"sold {LOT_QTY}; the {OLD_MONTHS}-month-old lot still holds {left_old} "
           f"while the {FRESH_MONTHS}-month-old one holds {left_fresh}")
    _claim(rep, code, left_fresh == LOT_QTY,
           "the newer lot was not touched", "THE NEWER LOT WAS TAKEN INSTEAD",
           f"the new pallet went down to {left_fresh}")


def _a_lot_nobody_dated_waits_its_turn(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    "We don't know when this was made" is not "it's new" and not "it's ancient".

    Undated sorts LAST, which is where it sat before manufacture dates were read
    at all — that part was already right and has to stay right, or a shop that
    has never typed a DOT code would find its whole shelf reordered.
    """
    _clear(api, rep, code, token, pid)

    # Undated first, so insertion order would hand it out.
    unknown = _lot(api, token, pid, "SWEEP-UNDATED")
    dated = _lot(api, token, pid, "SWEEP-DATED", months=FRESH_MONTHS)
    if unknown is None or dated is None:
        return

    if not _sell(api, token, pid, LOT_QTY):
        return

    left_dated = _left(api, token, pid, "SWEEP-DATED")
    left_unknown = _left(api, token, pid, "SWEEP-UNDATED")

    _claim(rep, code, left_dated == 0.0 and left_unknown == LOT_QTY,
           "a dated lot goes before an undated one", "AN UNDATED LOT JUMPED THE QUEUE",
           f"dated lot holds {left_dated}, undated lot holds {left_unknown}")


# ── the counter ────────────────────────────────────────────────────────

def _the_counter_is_told_which_lot_it_is_handing_over(
        api: Api, rep: Report, code: str, token: str, pid: str, product: dict) -> None:
    """
    Settings promises this in as many words: "the counter is told, and the
    decision stays with whoever is standing there."

    And it must name the lot the customer will ACTUALLY be given — naming the
    newest pallet while handing over the 2019 set is worse than silence.
    """
    _clear(api, rep, code, token, pid)
    _lot(api, token, pid, "SWEEP-NEW", months=FRESH_MONTHS)
    _lot(api, token, pid, "SWEEP-MID", months=MID_MONTHS)
    _lot(api, token, pid, "SWEEP-OLD", months=OLD_MONTHS)

    sku = product.get("sku") or product.get("barcode")
    if not sku:
        rep.query("S", f"{code} · something to scan", "the shelf item has neither sku nor barcode")
        return

    status, body = api.get(f"/pos/lookup?code={sku}", token=token)
    if status != 200:
        rep.query("S", f"{code} · the till finds the item", f"{status}")
        return

    aged = (body.get("data") or {}).get("aged")

    _claim(rep, code, (aged or {}).get("batch_number") == "SWEEP-OLD",
           "the counter is told which lot is old", "THE COUNTER IS NOT TOLD THE LOT IS OLD",
           f"scanned with a {OLD_MONTHS}-month-old lot on the shelf; aged={aged}")
    _claim(rep, code, bool((aged or {}).get("age")),
           "and how old, in words a counter says out loud", "THE COUNTER IS NOT TOLD HOW OLD",
           f"aged={aged}")


def _a_fresh_lot_says_nothing_at_the_counter(
        api: Api, rep: Report, code: str, token: str, pid: str, product: dict) -> None:
    """A notice on every scan is a notice nobody reads."""
    _clear(api, rep, code, token, pid)
    _lot(api, token, pid, "SWEEP-NEW", months=FRESH_MONTHS)

    sku = product.get("sku") or product.get("barcode")
    if not sku:
        return

    status, body = api.get(f"/pos/lookup?code={sku}", token=token)
    if status != 200:
        return

    rep.expect("S", f"{code} · a fresh lot is not warned about",
               (body.get("data") or {}).get("aged"), None)


# ── the sweep ──────────────────────────────────────────────────────────

def _the_shelf_can_be_swept_in_one_question(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    "How old is THIS lot" was answerable. "Which of my lots are old" was not,
    and a shop carrying two hundred sizes was never going to open two hundred
    drawers to find out.
    """
    _clear(api, rep, code, token, pid)
    _lot(api, token, pid, "SWEEP-OLD", months=OLD_MONTHS)
    _lot(api, token, pid, "SWEEP-MID", months=MID_MONTHS)
    _lot(api, token, pid, "SWEEP-NEW", months=FRESH_MONTHS)
    _lot(api, token, pid, "SWEEP-UNDATED")

    status, body = api.get("/inventory/ageing", token=token)
    if status != 200:
        rep.bug("S", f"{code} · the shelf can be swept for old stock", f"GET /inventory/ageing → {status}")
        return

    mine = [r["batch_number"] for r in _rows(body) if str(r.get("batch_number", "")).startswith("SWEEP-")]

    # Only what is actually old, oldest first. Fresh stock is not a worklist,
    # and a lot nobody dated is not evidence of age.
    # Joined, not passed as a list: `Report.expect` reads a list `want` as "any
    # one of these will do", which for an ORDER is the wrong question — and it
    # reported the exactly-right answer as something to look at.
    _claim(rep, code, " → ".join(mine) == "SWEEP-OLD → SWEEP-MID",
           "the sweep lists the aged lots, oldest first", "THE SHELF CANNOT BE SWEPT FOR OLD STOCK",
           f"four lots on the shelf, two of them old; the sweep answered {mine}")

    row = next((r for r in _rows(body) if r.get("batch_number") == "SWEEP-OLD"), None)
    rep.expect("S", f"{code} · each row says what it is and how old",
               bool(row and (row.get("product") or {}).get("name") and row.get("age")),
               True, f"row={row}")


def _a_stricter_question_can_be_asked_of_the_same_shelf(
        api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    A fleet contract or an insurer may hold a shop to less than its own shelf
    policy, without that becoming the shop's policy. Asked with `?years=`, so
    nothing about the shop is changed to ask it.
    """
    _clear(api, rep, code, token, pid)
    _lot(api, token, pid, "SWEEP-FOURISH", months=50)

    status, body = api.get("/inventory/ageing", token=token)
    lenient = [r["batch_number"] for r in _rows(body) if r.get("batch_number") == "SWEEP-FOURISH"]

    status, body = api.get("/inventory/ageing?years=3", token=token)
    strict = [r["batch_number"] for r in _rows(body) if r.get("batch_number") == "SWEEP-FOURISH"]

    rep.expect("S", f"{code} · a four-year lot is not old by default", len(lenient), 0)
    rep.expect("S", f"{code} · and is old to somebody asking about three years",
               " → ".join(strict), "SWEEP-FOURISH")


def _an_old_lot_is_still_sold(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    The point of the whole design. An age is a warning; refusing the sale would
    block a shopkeeper who has priced the age in, which is worse than useless.
    """
    _clear(api, rep, code, token, pid)
    _lot(api, token, pid, "SWEEP-OLD", months=OLD_MONTHS)

    _claim(rep, code, _sell(api, token, pid, 1.0),
           "an old lot is sold, not refused", "AN OLD LOT WAS REFUSED RATHER THAN SOLD",
           "an age is a warning, never a fence — refusing the sale blocks a "
           "shopkeeper who has priced the age in")


# ── helpers ────────────────────────────────────────────────────────────

def _claim(rep: Report, code: str, holds: bool, held: str, failed: str, detail: str = "") -> bool:
    """
    A claim whose failure is a defect, not a curiosity.

    `Report.expect` files a QUERY — right for "this behaved differently than I
    guessed", wrong for "the shop sold the wrong tyre". It also makes a check
    invisible to `mutate.py`, which looks for BUG rows: a claim that can only
    ever emit a QUERY cannot be proven to have teeth.

    Two wordings, not one negative reused. A row reading "ok · an old lot was
    refused rather than sold" says the opposite of what happened, and a log
    nobody can read straight is a log nobody reads.
    """
    if holds:
        rep.ok("S", f"{code} · {held}")
        return True
    rep.bug("S", f"{code} · {failed}", detail)
    return False


def _ageable_type(item_types: list) -> str | None:
    """A type whose lots may be dated by manufacture rather than by expiry."""
    for t in ("physical_product", "food"):
        if t in item_types:
            return t
    return None


def _shelf_item(api: Api, rep: Report, code: str, token: str, item_type: str) -> dict | None:
    """
    A product this phase owns.

    Deliberately NOT phase C's product: putting lots on that one turns it
    batch-managed for every later run, and a phase that changes what an earlier
    phase built is a phase whose failures land on somebody else.
    """
    status, body = api.get(f"/products?search={SHELF.replace(' ', '+')}", token=token)
    found = next((p for p in _rows(body) if p.get("name") == SHELF), None)
    if found is not None:
        _restock(api, token, found["id"])
        return found

    status, body = api.post("/products", {
        "item_type": item_type,
        "name": SHELF,
        # NOT the trade code. `SWEEP-SHELF-PETROLEUM` matched phase Q's search
        # for "Petrol" — product search reads the SKU too — and phase Q took the
        # newest row, so a tyre-age product became the forecourt's fuel product
        # and the rate check died. SKUs are unique per TENANT, so one name does
        # for every shop.
        "sku": "SWEEP-SHELF",
        "price": 1200,
        "cost": 800,
        "tax_rate": 0,
        "track_inventory": True,
        "stock_quantity": 200,
    }, token=token)

    if status in (200, 201):
        return body.get("data") or {}

    rep.query("S", f"{code} · create a shelf item", f"{status} · {str(body)[:120]}")
    return None


def _restock(api: Api, token: str, pid: str) -> None:
    """Enough on hand that a sale is never refused for the wrong reason."""
    api.post("/inventory/adjust", {
        "product_id": pid, "type": "set", "new_quantity": 200,
        "reason": "sweep phase S reset",
    }, token=token)


def _clear(api: Api, rep: Report, code: str, token: str, pid: str) -> None:
    """
    Start from a shelf with no lots of this phase's own making.

    Every check below states a WHOLE shelf — "these two lots, and the older one
    goes first" — so a lot left behind by the previous check is a lot the next
    one silently sells instead, and the answer it reads is about a shelf nobody
    described.

    ── The first version did not clear anything ────────────────────────────

    It zeroed each lot with a batch-scoped stock adjustment and then deleted the
    row. Neither worked, and the run was green anyway:

      · a movement with `reference_type: batch` is EXEMPT from batch accounting
        by design — those movements reconcile stock TO the lots and must not
        re-deplete them — so the lot kept its quantity.
      · deleting a lot that still has stock in it is refused, 422. Correctly:
        forty strips of medicine do not vanish, they are binned or they go back
        to the distributor, and the platform makes somebody say which.

    So the honest way to take a lot off a shelf is the way the shop does it —
    DELETE with a disposition, which writes it off and records the loss. An
    empty lot needs no disposition and gets none; passing one anyway is
    harmless and keeps this to one call.

    Failure is reported, not ignored. A clear that quietly does nothing turns
    every check after it into an assertion about the wrong shelf, which is worse
    than the check not existing.
    """
    for row in _lots(api, token, pid):
        if not str(row.get("batch_number", "")).startswith("SWEEP-"):
            continue
        # `api.delete` takes no body, and this needs one.
        status, body = api.call("DELETE", f"/inventory/batches/{row['id']}",
                                {"disposition": "written_off", "reason": "other"}, token=token)
        if status not in (200, 204):
            rep.query("S", f"{code} · clear lot {row.get('batch_number')}",
                      f"{status} · {str(body)[:110]} — the next check reads a shelf it did not set")
    _restock(api, token, pid)


def _lot(api: Api, token: str, pid: str, number: str,
         months: int | None = None, dot: str | None = None) -> dict | None:
    body: dict = {"batch_number": number, "quantity": LOT_QTY}
    if dot is not None:
        body["dot_code"] = dot
    elif months is not None:
        body["manufactured_on"] = _months_ago(months)

    status, payload = api.post(f"/inventory/products/{pid}/batches", body, token=token)
    return (payload.get("data") or {}) if status in (200, 201) else None


def _months_ago(months: int) -> str:
    """A date `months` back, without importing a calendar library."""
    import datetime
    today = datetime.date.today()
    total = today.year * 12 + (today.month - 1) - months
    year, month = divmod(total, 12)
    # The 28th, so no month is short of it.
    return f"{year:04d}-{month + 1:02d}-28"


def _lots(api: Api, token: str, pid: str) -> list:
    status, body = api.get(f"/inventory/products/{pid}/batches", token=token)
    return _rows(body) if status == 200 else []


def _row(api: Api, token: str, pid: str, number: str) -> dict | None:
    return next((r for r in _lots(api, token, pid) if r.get("batch_number") == number), None)


def _left(api: Api, token: str, pid: str, number: str) -> float | None:
    row = _row(api, token, pid, number)
    return None if row is None else float(row.get("quantity") or 0)


def _sell(api: Api, token: str, pid: str, qty: float) -> bool:
    status, _ = api.post("/sales", {
        "channel": "walk_in", "payment_method": "cash", "amount_paid": 100000,
        "items": [{"product_id": pid, "quantity": qty}],
    }, token=token)
    return status in (200, 201)


def _rows(body: dict) -> list:
    data = body.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("data") or []
    return []
