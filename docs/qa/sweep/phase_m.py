"""
Phase M — the money the shop gives away on purpose.

Points, coupons and promotions are all one thing wearing three hats: a discount
the shop has decided in advance to hand out. They fail in the same two ways, and
both are expensive:

    GIVEN TWICE   a coupon that can be used past its limit, points earned on a
                  bill that was later refunded, a BOGO that stacks with itself
    NOT GIVEN     a customer told they have 400 points and charged full price

The rule underneath all of it is the one from Phase C, applied to discounts:
**a client may name the coupon, never the amount.** A discount computed anywhere
but the server is a "give me any price I like" field with better manners.

The loyalty half also has to survive a reversal. Points are money the shop owes;
earning them on a sale that is later returned leaves the shop paying for goods
that came back.
"""

import uuid

from api import Api, Report
from phase_c import PRICE

PHONE = "03007776655"
EARN_PER = 100.0     # Rs 100 spent = 1 point
REDEEM_VALUE = 1.0   # 1 point = Rs 1
COUPON = "SWEEP10"


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code in ("mart", "retail"):
        state = sold.get(code)
        if state is None or not (state.get("features") or {}).get("pos"):
            continue

        token = state["token"]
        _settings(api, token)
        customer = _customer(api, token)

        # Every check here rings the PLAIN product. The sweep's usual item
        # carries a scheduled 20% promotion by the time this phase runs, and it
        # stacks: a 10-point redemption on it discounted 110, which reads as
        # points being worth eleven times what the shop set. A phase that
        # measures a discount has to ring something nothing else is discounting.
        plain = _plain_product(api, token)
        if plain is None:
            rep.query("M", f"{code} · a product with no promotion on it", "could not make one")
            continue

        _points_are_earned_and_spent(api, rep, code, token, state, customer, plain)
        _a_refund_takes_the_points_back(api, rep, code, token, state, customer)
        _a_coupon_is_named_never_priced(api, rep, code, token, state)
        _a_discount_needs_the_permission_to_give_it(api, rep, code, token, state)
        _a_coupon_stops_at_its_limit(api, rep, code, token, state)
        _a_promotion_prices_itself(api, rep, code, token, state)

    return sold


# ── points ─────────────────────────────────────────────────────────────

def _points_are_earned_and_spent(api: Api, rep: Report, code: str, token: str,
                                 state: dict, customer: str | None, plain: dict) -> None:
    """
    Earn on the way in, spend on the way out, and the shop decides the rate.

    `redeem_points` is a COUNT, never an amount — the server multiplies it by
    its own `loyalty_redeem_value`. A client that could send the rupees instead
    could settle any bill with points it does not have.
    """
    if customer is None:
        rep.query("M", f"{code} · a customer to hold points", "none")
        return

    before = _points(api, token, customer)
    if before is None:
        rep.query("M", f"{code} · points are readable", "no loyalty_points")
        return

    price = float(plain.get("price") or 0)

    # A bill of 5 × 500 = 2500 earns 25 points at 1 per Rs 100.
    status, body = api.post("/sales", {
        "channel": "pos",
        "customer_name": "Sweep Loyal", "customer_phone": PHONE,
        "items": [{"product_id": plain["id"], "quantity": 5}],
        "payment_method": "cash", "amount_paid": 5 * price,
    }, token=token)

    if status not in (200, 201):
        rep.bug("M", f"{code} · sell to a loyalty customer", _why(status, body))
        return

    sale = body.get("data") or {}
    spent = float(sale.get("total") or 0)
    after = _points(api, token, customer)
    earned = (after or 0) - before
    want = int(spent // EARN_PER)

    if earned != want:
        rep.bug("M", f"{code} · POINTS ARE EARNED AT THE SHOP'S RATE",
                f"spent {spent:.0f} at 1 per {EARN_PER:.0f} should earn {want}, earned {earned}")
    else:
        rep.ok("M", f"{code} · earned {earned} points on {spent:.0f}")

    state["loyalty_sale"] = sale

    # Spend some. The discount is points × the SHOP's redeem value.
    spend = min(10, after or 0)
    if spend <= 0:
        return

    status, body = api.post("/sales", {
        "channel": "pos",
        "customer_name": "Sweep Loyal", "customer_phone": PHONE,
        "items": [{"product_id": plain["id"], "quantity": 1}],
        "redeem_points": spend,
        "payment_method": "cash", "amount_paid": price,
    }, token=token)

    if status not in (200, 201):
        rep.bug("M", f"{code} · redeem points", _why(status, body))
        return

    redeemed = body.get("data") or {}
    discount = float(redeemed.get("discount") or 0)
    charged = float(redeemed.get("total") or 0)

    if abs(discount - spend * REDEEM_VALUE) > 0.01:
        rep.bug("M", f"{code} · POINTS ARE WORTH WHAT THE SHOP SAYS",
                f"{spend} points at {REDEEM_VALUE} should discount "
                f"{spend * REDEEM_VALUE:.0f}, discounted {discount}")
    elif abs(charged - (price - spend * REDEEM_VALUE)) > 0.01:
        rep.bug("M", f"{code} · a redeemed bill is charged net of the points",
                f"{price:.0f} − {spend * REDEEM_VALUE:.0f} = {price - spend * REDEEM_VALUE:.0f}, "
                f"charged {charged}")
    else:
        rep.ok("M", f"{code} · {spend} points took {discount:.0f} off")

    # The redeeming sale EARNS too, on what was actually paid — 25 − 10 spent
    # + 4 earned on the net 490 = 19. Checking only "held − spent" reported a
    # customer keeping points they had spent, when the shop was simply doing
    # both halves of its own scheme in one transaction.
    left = _points(api, token, customer)
    earned_back = int(charged // EARN_PER)
    want_left = (after or 0) - spend + earned_back

    if left is None:
        rep.query("M", f"{code} · points readable after redeeming", "absent")
    elif left != want_left:
        rep.bug("M", f"{code} · REDEEMING SPENDS THE POINTS",
                f"had {after}, spent {spend}, earned {earned_back} back on {charged:.0f} "
                f"→ {want_left}, holding {left}")
    else:
        rep.ok("M", f"{code} · spent {spend}, earned {earned_back} back", f"holding {left}")

    # And a customer cannot spend points they do not have.
    status, body = api.post("/sales", {
        "channel": "pos",
        "customer_name": "Sweep Loyal", "customer_phone": PHONE,
        "items": [{"product_id": plain["id"], "quantity": 1}],
        "redeem_points": 999999,
        "payment_method": "cash", "amount_paid": price,
    }, token=token)
    if status in (200, 201):
        rep.bug("M", f"{code} · POINTS CANNOT BE OVERSPENT",
                "a customer redeemed 999,999 points they do not hold")
    else:
        rep.ok("M", f"{code} · overspending points refused",
               (body.get("meta") or {}).get("error_code") or str(status))


def _a_refund_takes_the_points_back(api: Api, rep: Report, code: str, token: str,
                                    state: dict, customer: str | None) -> None:
    """
    Points earned on goods that came back are money the shop owes for nothing.

    The reversal is the half that gets forgotten, because earning is the part
    anybody demonstrates.
    """
    sale = state.get("loyalty_sale")
    if not sale or customer is None:
        return

    items = sale.get("items") or []
    if not items:
        return

    before = _points(api, token, customer)
    status, body = api.post(f"/sales/{sale['id']}/returns", {
        "items": [{"sale_item_id": items[0]["id"], "quantity": 5}],
        "reason": "QA sweep loyalty reversal", "refund_method": "cash",
    }, token=token)

    if status not in (200, 201):
        rep.query("M", f"{code} · return the loyalty sale", _why(status, body))
        return

    after = _points(api, token, customer)
    if before is None or after is None:
        return

    if after >= before:
        rep.bug("M", f"{code} · A REFUND TAKES THE POINTS BACK",
                f"the whole sale came back and the customer kept {after} points")
    else:
        rep.ok("M", f"{code} · refund reversed {before - after} points")


# ── coupons ────────────────────────────────────────────────────────────

def _a_coupon_is_named_never_priced(api: Api, rep: Report, code: str,
                                    token: str, state: dict) -> None:
    """
    The client hands over a code. The server decides what it is worth.

    Ten percent off a 1000 bill is 100 — and the sweep asks for a 900 discount
    in the same breath, which must be ignored exactly as `unit_price` is.
    """
    if _coupon(api, token) is None:
        rep.query("M", f"{code} · a coupon to redeem", "could not create one")
        return

    # `subtotal` is required, and it has to be: a coupon with a min_spend
    # cannot be judged without knowing what is in the basket, and answering
    # "valid" without checking would be worse than not answering.
    gross = 2 * PRICE
    status, body = api.post("/coupons/validate", {"code": COUPON, "subtotal": gross}, token=token)
    if status != 200:
        rep.bug("M", f"{code} · a cashier can check a coupon", _why(status, body))
    else:
        quoted = float((body.get("data") or {}).get("discount") or 0)
        if abs(quoted - gross * 0.10) > 0.01:
            rep.bug("M", f"{code} · THE COUNTER IS QUOTED THE COUPON'S REAL VALUE",
                    f"10% of {gross:.0f} = {gross * 0.10:.0f}, quoted {quoted}")
        else:
            rep.ok("M", f"{code} · coupon checked at the counter", f"{quoted:.0f} off")

    # A CLEAN product, so a scheduled promotion on the sweep's usual item does
    # not stack into this figure and make the coupon look wrong.
    plain = _plain_product(api, token)
    if plain is None:
        rep.query("M", f"{code} · a product with no promotion on it", "could not make one")
        return

    price = float(plain.get("price") or 0)
    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": plain["id"], "quantity": 2}],
        "coupon_code": COUPON,
        "payment_method": "cash", "amount_paid": 2 * price,
    }, token=token)

    if status not in (200, 201):
        rep.bug("M", f"{code} · redeem a coupon", _why(status, body))
        return

    sale = body.get("data") or {}
    discount = float(sale.get("discount") or 0)
    gross = 2 * price

    if abs(discount - gross * 0.10) > 0.01:
        rep.bug("M", f"{code} · THE SERVER PRICES THE COUPON",
                f"10% of {gross:.0f} = {gross * 0.10:.0f}, discounted {discount}")
    else:
        rep.ok("M", f"{code} · coupon worth exactly 10%", f"{discount:.0f} off {gross:.0f}")


def _a_discount_needs_the_permission_to_give_it(api: Api, rep: Report, code: str,
                                                token: str, state: dict) -> None:
    """
    The whole-bill `discount` field is NOT like `unit_price`.

    A cashier keying "Rs 200 off" is a real thing shops do, so the field is
    accepted — and fenced by `discounts.apply` instead. That fence is the only
    thing between a bill and any price the person at the till fancies, and it
    once governed only the per-LINE discount: a cashier with plain sales.manage
    could key Rs 5,000 off a Rs 5,200 bill and nothing stopped them.

    Both halves are checked, because the bug was that only one was.
    """
    cashier = _staff(api, token, f"sweep-{code}-nodiscount@qa.test",
                     "Sweep No-Discount Cashier", ["sales.manage", "customers.manage"])
    if cashier is None:
        # Reported, never skipped silently, and never run with the ambient
        # token instead: a 401 from the wrong identity looks exactly like the
        # 403 this check is hoping for.
        rep.query("M", f"{code} · a cashier without discounts.apply", "could not sign one in")
        return

    item = _plain_product(api, token)
    pid = (item or state["product"])["id"]

    whole = {
        "channel": "pos",
        "items": [{"product_id": pid, "quantity": 1}],
        "discount": 400,
        "payment_method": "cash", "amount_paid": PRICE,
    }
    status, _ = api.post("/sales", whole, token=cashier)
    if status in (200, 201):
        rep.bug("M", f"{code} · A WHOLE-BILL DISCOUNT NEEDS DISCOUNTS.APPLY",
                "a cashier without it keyed 400 off the bill")
    elif status == 401:
        rep.query("M", f"{code} · whole-bill discount probe", "401 — ran as nobody, proves nothing")
    else:
        rep.ok("M", f"{code} · whole-bill discount refused without the permission", str(status))

    per_line = {
        "channel": "pos",
        "items": [{"product_id": pid, "quantity": 1, "line_discount": 400}],
        "payment_method": "cash", "amount_paid": PRICE,
    }
    status, _ = api.post("/sales", per_line, token=cashier)
    if status in (200, 201):
        rep.bug("M", f"{code} · A LINE DISCOUNT NEEDS DISCOUNTS.APPLY",
                "a cashier without it keyed 400 off a line")
    elif status == 401:
        rep.query("M", f"{code} · line discount probe", "401 — ran as nobody, proves nothing")
    else:
        rep.ok("M", f"{code} · line discount refused without the permission", str(status))

    # And with the permission, it goes through — or the fence is a wall.
    allowed = _staff(api, token, f"sweep-{code}-discounter@qa.test",
                     "Sweep Discounting Cashier",
                     ["sales.manage", "customers.manage", "discounts.apply"])
    if allowed is None:
        return

    status, body = api.post("/sales", whole, token=allowed)
    if status in (200, 201):
        rep.ok("M", f"{code} · with discounts.apply the discount is allowed")
    else:
        rep.bug("M", f"{code} · DISCOUNTS.APPLY ACTUALLY GRANTS IT", _why(status, body))


def _a_coupon_stops_at_its_limit(api: Api, rep: Report, code: str,
                                 token: str, state: dict) -> None:
    """
    A one-use coupon used twice is a discount the shop never agreed to.

    The limit is the whole promise of a coupon: a code shared on WhatsApp
    reaches a thousand people, and the only thing standing between that and a
    thousand discounts is this counter.
    """
    # A NEW code each run. A fixed one is spent on the first run and every run
    # after it takes the "already used" branch — so the first-use half stops
    # being exercised at all, while the sweep still prints a pass for it. The
    # serials in phase G had the same weakness and the same fix.
    once = f"SWEEPONCE{uuid.uuid4().hex[:8].upper()}"
    api.post("/coupons", {
        "code": once, "type": "fixed", "value": 50, "usage_limit": 1, "is_active": True,
    }, token=token)

    ring = {
        "channel": "pos",
        "items": [{"product_id": state["product"]["id"], "quantity": 1}],
        "coupon_code": once,
        "payment_method": "cash", "amount_paid": PRICE,
    }

    first, body = api.post("/sales", ring, token=token)
    if first not in (200, 201):
        rep.bug("M", f"{code} · a fresh one-use coupon works once", _why(first, body))
        return
    rep.ok("M", f"{code} · one-use coupon redeemed once")

    second, body = api.post("/sales", ring, token=token)

    if second in (200, 201):
        rep.bug("M", f"{code} · A SINGLE-USE COUPON IS USED ONCE",
                "the same code was redeemed twice")
    else:
        rep.ok("M", f"{code} · second use of a one-use coupon refused",
               (body.get("meta") or {}).get("error_code") or str(second))


# ── promotions ─────────────────────────────────────────────────────────

def _a_promotion_prices_itself(api: Api, rep: Report, code: str,
                               token: str, state: dict) -> None:
    """
    A scheduled discount with no code — the shop decides, the till obeys.

    The preview is what the cashier is shown BEFORE tendering, and it has to
    agree with what the sale then charges. Two different numbers there is worse
    than no preview: the cashier quotes one and the customer is charged the
    other, at the counter, in front of them.
    """
    # Its own product. Scheduling a promotion against the sweep's usual item
    # made phase C's server-pricing check charge 800 instead of 1000 on the
    # NEXT run — a phase quietly re-pricing another phase's subject, reported
    # as a pricing bug three phases away from the cause.
    promo_item = _promo_product(api, token)
    if promo_item is None:
        rep.query("M", f"{code} · a product to promote", "could not make one")
        return

    pid = promo_item["id"]
    price = float(promo_item.get("price") or 0)
    name = "Sweep 20% off"

    status, body = api.get("/promotions", token=token)
    rows = _rows(body) if status == 200 else []
    promo = next((p for p in rows if p.get("name") == name), None)

    if promo is None:
        status, body = api.post("/promotions", {
            "name": name, "type": "percent", "value": 20,
            "scope": "product", "product_ids": [pid], "is_active": True,
        }, token=token)
        if status not in (200, 201):
            rep.query("M", f"{code} · schedule a promotion", _why(status, body))
            return
        rep.ok("M", f"{code} · promotion scheduled", name)

    status, body = api.post("/promotions/preview", {
        "items": [{"product_id": pid, "quantity": 2}],
    }, token=token)
    if status != 200:
        rep.bug("M", f"{code} · the till can preview a promotion", str(status))
        return

    d = body.get("data") or {}
    quoted = float(d.get("discount") or (d.get("totals") or {}).get("discount") or 0)

    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": pid, "quantity": 2}],
        "payment_method": "cash", "amount_paid": 2 * price,
    }, token=token)
    if status not in (200, 201):
        rep.bug("M", f"{code} · sell under a promotion", _why(status, body))
        return

    charged = float((body.get("data") or {}).get("discount") or 0)

    if quoted == 0 and charged == 0:
        rep.query("M", f"{code} · the promotion applied to anything",
                  "preview and sale both discounted nothing")
    elif abs(quoted - charged) > 0.01:
        rep.bug("M", f"{code} · THE PREVIEW AGREES WITH THE BILL",
                f"the cashier was quoted {quoted:.2f} and the customer was charged "
                f"a discount of {charged:.2f}")
    else:
        rep.ok("M", f"{code} · preview and bill agree", f"{charged:.0f} off")


# ── plumbing ───────────────────────────────────────────────────────────

def _settings(api: Api, token: str) -> None:
    api.put("/shop/settings", {
        "loyalty_enabled": True,
        "loyalty_earn_per_amount": EARN_PER,
        "loyalty_redeem_value": REDEEM_VALUE,
        "loyalty_min_redeem": 0,
    }, token=token)


def _customer(api: Api, token: str) -> str | None:
    status, body = api.get(f"/customers?search={PHONE}", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((c for c in rows if c.get("phone") == PHONE), None)
    if found:
        return found["id"]
    status, body = api.post("/customers", {"name": "Sweep Loyal", "phone": PHONE}, token=token)
    return (body.get("data") or {}).get("id") if status in (200, 201) else None


def _points(api: Api, token: str, customer_id: str) -> int | None:
    status, body = api.get(f"/customers/{customer_id}", token=token)
    if status != 200:
        return None
    p = (body.get("data") or {}).get("loyalty_points")
    return None if p is None else int(p)


def _coupon(api: Api, token: str) -> str | None:
    status, body = api.get("/coupons", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((c for c in rows if c.get("code") == COUPON), None)
    if found:
        return found["id"]
    status, body = api.post("/coupons", {
        "code": COUPON, "type": "percent", "value": 10, "is_active": True,
    }, token=token)
    return (body.get("data") or {}).get("id") if status in (200, 201) else None


def _promo_product(api: Api, token: str) -> dict | None:
    """The one product this phase is allowed to discount."""
    return _named_product(api, token, "Sweep Promoted Item")


def _plain_product(api: Api, token: str) -> dict | None:
    """A product no promotion is scheduled against."""
    return _named_product(api, token, "Sweep Plain Item")


def _named_product(api: Api, token: str, name: str) -> dict | None:
    status, body = api.get(f"/products?search={name.replace(' ', '+')}", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((p for p in rows if p.get("name") == name), None)
    if found:
        return found
    status, body = api.post("/products", {
        "item_type": "physical_product", "name": name, "price": 500, "cost": 300,
        "tax_rate": 0, "track_inventory": False,
    }, token=token)
    return (body.get("data") or {}) if status in (200, 201) else None


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
