"""
Phase U — the same thing in three sizes.

A shirt in S, M and L. A medicine in 250mg and 500mg. A drink half and full.
One product, several things on the shelf, and the whole subject is that they
are NOT interchangeable:

    ITS OWN PRICE    Large costs what Large costs, and the parent's price is
                     not a fallback anybody may quietly land on
    ITS OWN STOCK    selling a Large takes one off Large. The parent's
                     `stock_quantity` is an orphan for a varianted product —
                     the server's own `effectiveStock()` says so
    ITS OWN SHELF    and the figure a counter reads is THIS BRANCH's, not the
                     sum of every branch in the business
    FENCED           a variant_id belonging to another product is refused, not
                     resolved to something plausible

Written the day the picker shipped, because until then the only path in the
whole product that could produce a variant line was the barcode scanner — the
till's tap handler sent `variant_id: null` every time. So the server side had
been correct and untouched for months while no screen could reach it, which is
exactly the state a sweep driving HTTP is blind to: every one of these calls
would have passed the day before the feature existed.

That is the point of running them anyway. The claims below are about the
CONTRACT the two pickers now depend on, and the day one of them regresses is
the day a shop charges Small's price for a Large without anybody noticing.

Not gated on a trade. Variants are a catalogue idea, not a food idea — a
pharmacy's strengths and a tyre shop's sizes are the same mechanism — so every
shop that can hold stock is asked.
"""

from api import Api, Report

SIZED = "Sweep Sized Item"

# Three prices far enough apart that no assertion can pass by coincidence, and
# none of them equal to the parent's.
SIZES = [("Small", 500.0), ("Medium", 750.0), ("Large", 900.0)]
PARENT_PRICE = 111.0
TOP_UP = 8.0


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code, state in sold.items():
        if not (state.get("features") or {}).get("inventory"):
            rep.ok("U", f"{code} · no stock module", "skipped, correctly")
            continue

        token = state["token"]

        item_type = _stockable_type(state.get("item_types") or [])
        if item_type is None:
            rep.ok("U", f"{code} · nothing here holds stock",
                   f"item_types={state.get('item_types')}")
            continue

        product = _sized_product(api, rep, code, token, item_type)
        if product is None:
            rep.query("U", f"{code} · a product with sizes",
                      "could not create or restock one — nothing below ran")
            continue

        _a_size_sells_at_its_own_price(api, rep, code, token, product)
        _a_size_depletes_its_own_shelf(api, rep, code, token, product)
        _the_counter_reads_this_branchs_figure(api, rep, code, token, product)
        _a_size_from_another_product_is_refused(api, rep, code, token, product, item_type)
        _the_client_cannot_name_its_own_price(api, rep, code, token, product)
        _one_size_cannot_borrow_anothers_shelf(api, rep, code, token, product)

    return sold


# ── the fixture ────────────────────────────────────────────────────────

def _stockable_type(item_types: list) -> str | None:
    """A type this trade offers that can hold stock. Variants ride on goods."""
    codes = [t.get("code") if isinstance(t, dict) else t for t in item_types]
    for want in ("physical_product", "medicine", "tyre", "grocery_item", "food_item"):
        if want in codes:
            return want

    return None


def _sized_product(api: Api, rep: Report, code: str, token: str, item_type: str) -> dict | None:
    """
    Made once, reused, and TOPPED UP — the sweep's oldest rule.

    Phase G learned this the expensive way: a fixture created with fifty units
    and never restocked reported a real server refusal as a product bug on the
    fifty-first run. Every size here is set back to a working level before the
    claims run, so the tenth pass reads the same as the first.
    """
    status, body = api.get(f"/products?search={SIZED.replace(' ', '+')}", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((r for r in rows if r.get("name") == SIZED), None)

    if found is None:
        status, body = api.post("/products", {
            "item_type": item_type,
            "name": SIZED,
            "price": PARENT_PRICE,
            "cost": 60,
            "tax_rate": 0,
            "track_inventory": True,
            "variants": [
                {"name": n, "price": p, "stock_quantity": TOP_UP} for n, p in SIZES
            ],
        }, token=token)
        if status not in (200, 201):
            return None
        found = (body or {}).get("data")

    if not found:
        return None

    # Re-read, so the row carries whatever the LIST stamps (branch figures) —
    # the create response is a different shape and asserting on it would be
    # asserting on the wrong endpoint.
    status, body = api.get(f"/products?search={SIZED.replace(' ', '+')}", token=token)
    fresh = next((r for r in (_rows(body) if status == 200 else []) if r.get("id") == found["id"]), None)
    if fresh is None:
        return None

    for v in fresh.get("variants") or []:
        if _on_hand(v) < 3:
            api.post("/inventory/adjust", {
                "product_id": fresh["id"], "variant_id": v["id"],
                "type": "set", "new_quantity": TOP_UP, "reason": "sweep phase U restock",
            }, token=token)

    status, body = api.get(f"/products?search={SIZED.replace(' ', '+')}", token=token)

    return next((r for r in (_rows(body) if status == 200 else []) if r.get("id") == found["id"]), None)


# ── the claims ─────────────────────────────────────────────────────────

def _a_size_sells_at_its_own_price(api: Api, rep: Report, code: str, token: str, product: dict) -> None:
    """
    THE claim with money in it.

    The parent is priced at 111 and no size is. If a line ever comes back at the
    parent's price, a shop selling three sizes is charging one — silently, and on
    every sale.
    """
    large = _size(product, "Large")
    if large is None:
        rep.query("U", f"{code} · the product has a Large", "no such size on the row")
        return

    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": product["id"], "variant_id": large["id"], "quantity": 1}],
        "payment_method": "cash", "amount_paid": 2000,
    }, token=token)
    if status not in (200, 201):
        rep.bug("U", f"{code} · sell one Large", _why(status, body))
        return

    line = ((body or {}).get("data") or {}).get("items") or []
    got = float(line[0].get("unit_price") or 0) if line else 0.0

    rep.expect("U", f"{code} · a size sells at its own price", got, 900.0,
               f"unit_price {got} — the parent is {PARENT_PRICE}")

    # And the line says WHICH size, or a receipt cannot be read back.
    named = (line[0].get("variant_name") or line[0].get("name") or "") if line else ""
    rep.expect("U", f"{code} · the sold line names the size", "Large" in str(named), True,
               f"line reads {named!r}")


def _a_size_depletes_its_own_shelf(api: Api, rep: Report, code: str, token: str, product: dict) -> None:
    """
    Selling a Large must not take one off Small.

    The parent's `stock_quantity` is an orphan for a varianted product and the
    server says so in `Product::effectiveStock()`. What matters to a shop is
    narrower and checkable: the size that left is the size that fell.
    """
    before = _by_size(_reread(api, token, product["id"]))
    if not {"Small", "Large"} <= set(before):
        rep.query("U", f"{code} · both sizes are on the shelf", f"have {sorted(before)}")
        return

    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": product["id"], "variant_id": _size(product, "Large")["id"], "quantity": 1}],
        "payment_method": "cash", "amount_paid": 2000,
    }, token=token)
    if status not in (200, 201):
        rep.bug("U", f"{code} · sell one Large to move its stock", _why(status, body))
        return

    after = _by_size(_reread(api, token, product["id"]))

    rep.expect("U", f"{code} · selling a Large takes one off Large",
               round(before["Large"] - after.get("Large", 0), 3), 1.0,
               f"Large {before['Large']} → {after.get('Large')}")
    rep.expect("U", f"{code} · and takes nothing off Small",
               round(before["Small"] - after.get("Small", 0), 3), 0.0,
               f"Small {before['Small']} → {after.get('Small')}")


def _the_counter_reads_this_branchs_figure(api: Api, rep: Report, code: str, token: str, product: dict) -> None:
    """
    `branch_stock`, not the shop-wide rollup.

    A till standing in one branch that reads the rollup is being told about a
    rail it cannot reach — and the offline projection has always answered per
    branch, so the same size gave two different numbers depending on whether the
    line was up. The picker disables a chip on this figure, so it decides what a
    cashier is allowed to sell.
    """
    fresh = _reread(api, token, product["id"])
    sizes = (fresh or {}).get("variants") or []
    if not sizes:
        rep.query("U", f"{code} · the row carries its sizes", "none came back")
        return

    missing = [v.get("name") for v in sizes if v.get("branch_stock") is None]
    # Counted, not compared to an empty list: `Report.expect` refuses an empty
    # `want` because nothing can satisfy one, and it was right to refuse this.
    rep.expect("U", f"{code} · every size carries this branch's figure",
               len(missing), 0, f"of {len(sizes)} sizes, these carry none: {missing}")


def _a_size_from_another_product_is_refused(
    api: Api, rep: Report, code: str, token: str, product: dict, item_type: str,
) -> None:
    """
    A variant_id is only valid for ITS product.

    Nothing in the panel can send a mismatched pair, which is exactly why this
    is worth a call: the fence is invisible from the UI and would stay green in
    every screen test ever written. Resolving it to something plausible would
    price a line off a product the customer is not buying.
    """
    other = _another_product_with_a_size(api, token, product["id"])
    if other is None:
        # Make one, rather than skipping. The first run of this reported "only
        # one product here has sizes — nothing to cross" in every shop, which is
        # a check that cannot fail dressed as a check that passed.
        other = _second_sized_product(api, token, item_type)
    if other is None:
        rep.query("U", f"{code} · a second sized product to cross with",
                  "could not create one — the fence went unchecked")
        return

    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": product["id"], "variant_id": other, "quantity": 1}],
        "payment_method": "cash", "amount_paid": 2000,
    }, token=token)

    if status in (200, 201):
        rep.bug("U", f"{code} · A FOREIGN SIZE WAS ACCEPTED",
                "a variant belonging to another product priced this line")
    elif status == 422:
        rep.ok("U", f"{code} · a size from another product is refused")
    else:
        rep.query("U", f"{code} · a size from another product is refused",
                  f"got {status}, expected 422 — refused for the wrong reason proves nothing")


def _the_client_cannot_name_its_own_price(api: Api, rep: Report, code: str, token: str, product: dict) -> None:
    """
    Server-authoritative pricing, asked of a SIZE.

    The rule is enforced for a plain line and asserted elsewhere. A variant takes
    a different branch through the pricing code — `$variant->price` rather than
    the level price — so it is a different road to the same rule, and a road
    nobody drove.
    """
    large = _size(product, "Large")
    if large is None:
        return

    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{
            "product_id": product["id"], "variant_id": large["id"],
            "quantity": 1, "unit_price": 1.0,
        }],
        "payment_method": "cash", "amount_paid": 2000,
    }, token=token)

    if status not in (200, 201):
        # Refusing the field outright is a perfectly good answer.
        rep.ok("U", f"{code} · a client-supplied price on a size is refused", f"{status}")
        return

    line = ((body or {}).get("data") or {}).get("items") or []
    got = float(line[0].get("unit_price") or 0) if line else 0.0
    if got == 1.0:
        rep.bug("U", f"{code} · A CLIENT PRICED ITS OWN SIZE",
                "the sale took unit_price 1.00 from the request")
    else:
        rep.expect("U", f"{code} · the server prices a size, whatever the client sends",
                   got, 900.0, f"sent 1.00, got {got}")


def _one_size_cannot_borrow_anothers_shelf(api: Api, rep: Report, code: str, token: str, product: dict) -> None:
    """
    Ask for more Larges than there are Larges.

    The subtle failure this pins: a stock guard reading the PRODUCT's figure
    instead of the size's would let it through, because the product's figure is
    the sum of all three sizes. Eight Larges on the shelf, twenty-four across the
    rail — so "sell twenty Larges" looks fine to anything asking the wrong
    question, and the shop promises fourteen shirts it does not have.

    Exactly the reading the till was doing until the picker shipped, and the
    reason `Product::effectiveStock()` carries a warning rather than a helper.
    """
    fresh = _reread(api, token, product["id"])
    large = _size(fresh or {}, "Large")
    if large is None:
        return

    have = _on_hand(large)
    everything = sum(_on_hand(v) for v in (fresh or {}).get("variants") or [])
    if everything <= have:
        rep.query("U", f"{code} · the rail holds more than one size does",
                  f"Large has {have} of {everything} — cannot tell the two figures apart")
        return

    # More than this size holds, still less than the rail holds — so only a
    # per-size reading can refuse it.
    want = int(have) + 1

    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": product["id"], "variant_id": large["id"], "quantity": want}],
        "payment_method": "cash", "amount_paid": 99999,
    }, token=token)

    if status in (200, 201):
        rep.bug("U", f"{code} · A SIZE SOLD MORE THAN IT HAD",
                f"asked for {want} Larges with {have} on the shelf "
                f"({everything} across the whole rail) and the sale went through")
    elif status == 422:
        rep.ok("U", f"{code} · a size cannot sell more than it holds",
               f"{want} refused with {have} on the shelf")
    else:
        rep.query("U", f"{code} · a size cannot sell more than it holds",
                  f"got {status}, expected 422 — refused for the wrong reason proves nothing")


# ── plumbing ───────────────────────────────────────────────────────────

def _rows(body: dict | None) -> list:
    data = (body or {}).get("data")

    return data if isinstance(data, list) else []


def _reread(api: Api, token: str, pid: str) -> dict | None:
    status, body = api.get(f"/products?search={SIZED.replace(' ', '+')}", token=token)

    return next((r for r in (_rows(body) if status == 200 else []) if r.get("id") == pid), None)


def _size(product: dict, name: str) -> dict | None:
    return next((v for v in (product.get("variants") or []) if v.get("name") == name), None)


def _on_hand(v: dict) -> float:
    """The branch figure when there is one, else the rollup — the till's rule."""
    branch = v.get("branch_stock")

    return float(branch if branch is not None else (v.get("stock_quantity") or 0))


def _by_size(product: dict | None) -> dict:
    return {v["name"]: _on_hand(v) for v in ((product or {}).get("variants") or []) if v.get("name")}


def _another_product_with_a_size(api: Api, token: str, not_this: str) -> str | None:
    status, body = api.get("/products?per_page=100", token=token)
    for row in _rows(body) if status == 200 else []:
        if row.get("id") == not_this:
            continue
        for v in row.get("variants") or []:
            if v.get("id"):
                return v["id"]

    return None


def _second_sized_product(api: Api, token: str, item_type: str) -> str | None:
    """A throwaway neighbour, so the ownership fence has something to be crossed with."""
    name = f"{SIZED} Neighbour"
    status, body = api.get(f"/products?search={name.replace(' ', '+')}", token=token)
    found = next((r for r in (_rows(body) if status == 200 else []) if r.get("name") == name), None)

    if found is None:
        status, body = api.post("/products", {
            "item_type": item_type, "name": name, "price": 222, "cost": 100,
            "tax_rate": 0, "track_inventory": True,
            "variants": [{"name": "Only", "price": 222, "stock_quantity": 2}],
        }, token=token)
        if status not in (200, 201):
            return None
        found = (body or {}).get("data")

    for v in (found or {}).get("variants") or []:
        if v.get("id"):
            return v["id"]

    return None


def _why(status: int, body: dict | None) -> str:
    msg = (body or {}).get("message") or ""
    err = ((body or {}).get("meta") or {}).get("error_code") or ""

    return f"{status} {err} {msg}".strip()
