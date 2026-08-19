"""
Phase R — the customer.

Every phase before this one runs as somebody who works at the shop: an owner, a
cashier, a stock keeper, an admin. **Nobody has ever driven the person the shop
exists for.**

That is a whole actor and a whole surface — `/marketplace/*` to look, and
`/customer/*` to keep addresses, leave reviews, hold reservations and PLACE
ORDERS — and it is reached with a role no sweep token has ever carried.

Three kinds of question, and only the first is about features working:

    THE ORDER      A customer names products and quantities and NEVER a price;
                   the shop's own catalog decides what it costs. Whether that
                   holds is not a matter of reading the request rules — a price
                   that arrives anyway must be ignored, and the total has to be
                   the server's own arithmetic.

    THE BOUNDARY   `shop_slug` and `items.*.product_id` arrive in one body and
                   nothing in the validation ties them together. A customer
                   ordering shop B's product from shop A is one request away,
                   and the only thing between them is code nobody has driven.

    THE OWNER      Orders, addresses, reviews and reservations are all "mine".
                   Every one of those controllers scopes by the signed-in user
                   — reading them says so. Reading is not proving, and this is
                   the class where a single missing `where` is somebody else's
                   address book.

Two customers exist here on purpose. A check that one person cannot see another
person's things is meaningless with one person.
"""

import uuid

from api import Api, Report

# Stable, so a second run signs in rather than registering — `throttle:auth` is
# five per minute per IP and the sweep shares it with every other login.
SHOPPER = "sweep-shopper@qa.test"
OTHER = "sweep-shopper-two@qa.test"
PASSWORD = "password1234"


def run(api: Api, rep: Report, sold: dict) -> dict:
    mine = _customer(api, rep, SHOPPER, "Sweep Shopper")
    theirs = _customer(api, rep, OTHER, "Sweep Shopper Two")

    if mine is None or theirs is None:
        rep.query("R", "a customer account", "could not register or sign in — nothing below ran")
        return sold

    _a_customer_is_not_staff(api, rep, mine)

    # Which of the sweep's shops the marketplace will actually show. A shop that
    # is not listed cannot be ordered from, and saying "0 of 8 shops were
    # driveable" is the difference between a clean phase and a blind one.
    open_shops = _shops_a_customer_can_see(api, rep, sold)

    if not open_shops:
        rep.query(
            "R", "a shop a customer can reach",
            "none of the sweep's shops are listed on the marketplace, so ordering could not be driven",
        )
        return sold

    for code, state in open_shops.items():
        slug = state["slug"]

        _the_shop_shows_its_catalog(api, rep, code, slug)
        order = _an_order_is_priced_by_the_shop(api, rep, code, slug, state, mine)

        if order is None:
            continue

        _a_price_from_the_customer_is_ignored(api, rep, code, slug, state, mine)
        _an_order_cannot_reach_across_shops(api, rep, code, slug, mine, sold)
        _somebody_elses_order_is_not_mine(api, rep, code, order, theirs)
        _my_orders_are_only_mine(api, rep, code, order, mine, theirs)
        _an_order_can_be_cancelled_once(api, rep, code, order, mine)

    _somebody_elses_address_is_not_mine(api, rep, mine, theirs)

    return sold


# ── identity ───────────────────────────────────────────────────────────

def _customer(api: Api, rep: Report, email: str, name: str) -> str | None:
    """Sign this shopper in, registering them the first time only."""
    token = api.login(email, PASSWORD)
    if token:
        return token

    status, body = api.post("/auth/register", {
        "name": name,
        "email": email,
        "password": PASSWORD,
        "password_confirmation": PASSWORD,
    })

    if status in (200, 201):
        rep.ok("R", f"{email} · registered")
        return (body.get("data") or {}).get("access_token") or api.login(email, PASSWORD)

    # Already there from a previous run, and the password is what it always was.
    if status == 422:
        return api.login(email, PASSWORD)

    rep.bug("R", "A CUSTOMER CAN REGISTER", f"{status} · {str(body)[:120]}")
    return None


def _a_customer_is_not_staff(api: Api, rep: Report, token: str) -> None:
    """
    The role fence, from the customer's side.

    A shopper holding a valid token is still a stranger to the shop's books.
    Asked of the two that would hurt most: the catalog they could edit and the
    till they could ring on.
    """
    for what, method, path, body in (
        ("read the shop's catalog", "GET", "/products", None),
        ("ring a sale", "POST", "/sales", {"channel": "pos", "items": [], "payment_method": "cash"}),
        ("read the shop's takings", "GET", "/reports/summary", None),
    ):
        status, _ = api.call(method, path, body, token=token)

        # 404 is NOT a refusal — it is "no such route", and reading it as one
        # accuses the product of a hole that is really a typo in this file. The
        # first version of this check pointed at `/reports/sales`, which does
        # not exist, and reported the customer had read the shop's takings.
        # Exactly the mistake phase I made with 403 and MODULE_DISABLED.
        if status == 404:
            rep.query("R", f"a customer cannot {what}", "404 — this path does not exist, so nothing was tested")
        elif status in (401, 403):
            rep.ok("R", f"a customer cannot {what}", f"{status}")
        else:
            rep.bug("R", f"A CUSTOMER CAN {what.upper()}", f"{status}")


# ── what a customer can see ────────────────────────────────────────────

def _shops_a_customer_can_see(api: Api, rep: Report, sold: dict) -> dict:
    """
    The sweep's shops that are actually on the marketplace, with their slugs.

    Marketplace visibility is a shop's own choice, so a sweep tenant not being
    listed is not a defect — but it IS the denominator for everything below.
    """
    open_shops: dict[str, dict] = {}

    for code, state in sold.items():
        token = state["token"]
        status, body = api.get("/auth/me", token=token)
        slug = ((body.get("data") or {}).get("tenant") or {}).get("slug") if status == 200 else None

        if not slug:
            continue

        # Asked as a stranger, with no token at all — which is how a customer
        # meets a shop.
        seen, _ = api.get(f"/marketplace/shops/{slug}")

        if seen == 200 and state.get("product"):
            open_shops[code] = {**state, "slug": slug}

    rep.ok("R", "shops a customer can reach", f"{len(open_shops)} of {len(sold)}")

    return open_shops


def _the_shop_shows_its_catalog(api: Api, rep: Report, code: str, slug: str) -> None:
    status, body = api.get(f"/marketplace/shops/{slug}/products")
    rows = _rows(body)

    if status != 200:
        rep.bug("R", f"{code} · A SHOP SHOWS ITS CATALOG", f"{status}")
        return

    if not rows:
        rep.query("R", f"{code} · the shop's public catalog is empty", "nothing to order")
        return

    rep.ok("R", f"{code} · public catalog", f"{len(rows)} items")


# ── the order ──────────────────────────────────────────────────────────

def _an_order_is_priced_by_the_shop(api: Api, rep: Report, code: str, slug: str,
                                    state: dict, token: str) -> dict | None:
    """
    The customer names what and how many. The shop names what it costs.
    """
    product = state["product"]
    status, body = api.post("/customer/orders", {
        "shop_slug": slug,
        "fulfillment_type": "pickup",
        "items": [{"product_id": product["id"], "quantity": 2}],
        "idempotency_key": str(uuid.uuid4()),
    }, token=token)

    if status not in (200, 201):
        rep.bug("R", f"{code} · A CUSTOMER CAN PLACE AN ORDER", f"{status} · {str(body)[:140]}")
        return None

    order = (body.get("data") or {})
    total = float(order.get("total") or 0)
    price = float(product.get("price") or 0)

    if total <= 0:
        rep.bug("R", f"{code} · AN ORDER HAS A TOTAL", f"{total}")
        return order

    # Two of something at the shop's own price. Tax, delivery and rounding are
    # the shop's business, so this asks that the figure is BUILT FROM the
    # catalog price rather than that it equals it exactly.
    if price > 0 and total < price * 2 - 0.01:
        rep.bug(
            "R", f"{code} · AN ORDER IS PRICED BY THE SHOP",
            f"2 × {price} came to {total}",
        )
    else:
        rep.ok("R", f"{code} · order priced by the shop", f"2 × {price} → {total}")

    return order


def _a_price_from_the_customer_is_ignored(api: Api, rep: Report, code: str, slug: str,
                                          state: dict, token: str) -> None:
    """
    THE RULE THIS WHOLE PRODUCT IS BUILT ON, asked from the outside.

    The request rules carry no price field, so a price cannot be validated in.
    That is the reason to check rather than a reason not to: the day somebody
    adds one for a legitimate path, this is the test that notices.
    """
    product = state["product"]
    price = float(product.get("price") or 0)

    status, body = api.post("/customer/orders", {
        "shop_slug": slug,
        "fulfillment_type": "pickup",
        "items": [{"product_id": product["id"], "quantity": 1, "unit_price": 0.01, "price": 0.01}],
        "idempotency_key": str(uuid.uuid4()),
    }, token=token)

    if status not in (200, 201):
        # Refusing the whole request is a perfectly good answer to a field that
        # has no business being there.
        rep.ok("R", f"{code} · a price from the customer is refused", f"{status}")
        return

    total = float((body.get("data") or {}).get("total") or 0)

    if price > 0 and total <= 0.02:
        rep.bug(
            "R", f"{code} · A CUSTOMER NAMED THEIR OWN PRICE",
            f"asked to pay 0.01 for a {price} item and the order totals {total}",
        )
    else:
        rep.ok("R", f"{code} · a price from the customer is ignored", f"charged {total}")


def _an_order_cannot_reach_across_shops(api: Api, rep: Report, code: str, slug: str,
                                        token: str, sold: dict) -> None:
    """
    `shop_slug` and `items.*.product_id` arrive in one body and NOTHING in the
    validation ties them together.

    An order naming this shop and another shop's product is one request away. If
    it were accepted, the shop would be told to hand over goods it does not
    stock, priced from a catalog that is not its own.

    The product is borrowed from ANY other shop the sweep built, not only from
    one a customer can see. The first version of this looked among the visible
    shops and found none — one of eight is listed — so the most valuable check
    in the phase quietly did not run. A shop being invisible to shoppers makes
    its products a BETTER probe, not a worse one: nothing about this request
    should reach them.
    """
    other = next((s for c, s in sold.items() if c != code and s.get("product")), None)

    if other is None:
        rep.query("R", f"{code} · an order cannot reach across shops", "no second shop to borrow from")
        return

    status, body = api.post("/customer/orders", {
        "shop_slug": slug,
        "fulfillment_type": "pickup",
        "items": [{"product_id": other["product"]["id"], "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, token=token)

    if status in (200, 201):
        rep.bug(
            "R", f"{code} · AN ORDER REACHED INTO ANOTHER SHOP",
            f"ordered {other['product']['id']} from {slug} and it was accepted ({status})",
        )
    else:
        rep.ok("R", f"{code} · an order cannot reach across shops", f"{status}")


# ── whose is it ────────────────────────────────────────────────────────

def _somebody_elses_order_is_not_mine(api: Api, rep: Report, code: str,
                                      order: dict, other_token: str) -> None:
    oid = order.get("id")
    if not oid:
        return

    status, _ = api.get(f"/customer/orders/{oid}", token=other_token)

    if status == 200:
        rep.bug("R", f"{code} · ANOTHER CUSTOMER READ THIS ORDER", f"{oid}")
    else:
        rep.ok("R", f"{code} · another customer cannot read this order", f"{status}")

    status, _ = api.post(f"/customer/orders/{oid}/cancel", {}, token=other_token)

    if status in (200, 201):
        rep.bug("R", f"{code} · ANOTHER CUSTOMER CANCELLED THIS ORDER", f"{oid}")
    else:
        rep.ok("R", f"{code} · another customer cannot cancel this order", f"{status}")


def _my_orders_are_only_mine(api: Api, rep: Report, code: str, order: dict,
                             mine: str, theirs: str) -> None:
    oid = order.get("id")

    status, body = api.get("/customer/orders", token=mine)
    ids = {r.get("id") for r in _rows(body)}

    if status != 200:
        rep.bug("R", f"{code} · A CUSTOMER CAN LIST THEIR ORDERS", f"{status}")
        return

    if oid not in ids:
        rep.bug("R", f"{code} · MY OWN ORDER IS IN MY LIST", f"{oid} missing from {len(ids)}")
    else:
        rep.ok("R", f"{code} · my order is in my list", f"{len(ids)} orders")

    status, body = api.get("/customer/orders", token=theirs)
    others = {r.get("id") for r in _rows(body)}

    if oid in others:
        rep.bug("R", f"{code} · ANOTHER CUSTOMER'S LIST CONTAINS MY ORDER", f"{oid}")
    else:
        rep.ok("R", f"{code} · another customer's list is their own", f"{len(others)} orders")


def _somebody_elses_address_is_not_mine(api: Api, rep: Report, mine: str, theirs: str) -> None:
    """
    An address book is a person's home, named and pinned on a map. The one place
    on this surface where a missing `where` is not an inconvenience.
    """
    status, body = api.post("/customer/addresses", {
        "label": "Sweep home",
        "address": "12 Sweep Street",
        "latitude": 24.86,
        "longitude": 67.01,
    }, token=mine)

    if status not in (200, 201):
        rep.query("R", "a customer can save an address", f"{status} · {str(body)[:120]}")
        return

    aid = (body.get("data") or {}).get("id")
    if not aid:
        rep.query("R", "a saved address has an id", str(body)[:120])
        return

    rep.ok("R", "a customer can save an address")

    status, _ = api.put(f"/customer/addresses/{aid}", {"label": "Taken over"}, token=theirs)

    if status in (200, 201):
        rep.bug("R", "ANOTHER CUSTOMER EDITED THIS ADDRESS", f"{aid}")
    else:
        rep.ok("R", "another customer cannot edit this address", f"{status}")

    status, _ = api.delete(f"/customer/addresses/{aid}", token=theirs)

    if status in (200, 204):
        rep.bug("R", "ANOTHER CUSTOMER DELETED THIS ADDRESS", f"{aid}")
    else:
        rep.ok("R", "another customer cannot delete this address", f"{status}")


# ── the life of an order ───────────────────────────────────────────────

def _an_order_can_be_cancelled_once(api: Api, rep: Report, code: str,
                                    order: dict, token: str) -> None:
    """
    A customer may pull out before the shop starts work, and only once. A second
    cancel that succeeds is a second stock restore, which is how a shelf grows
    items nobody ever put on it.
    """
    oid = order.get("id")
    if not oid:
        return

    status, body = api.post(f"/customer/orders/{oid}/cancel", {}, token=token)

    if status not in (200, 201):
        rep.query("R", f"{code} · a fresh order can be cancelled", f"{status} · {str(body)[:120]}")
        return

    rep.ok("R", f"{code} · a fresh order can be cancelled")

    status, _ = api.post(f"/customer/orders/{oid}/cancel", {}, token=token)

    if status in (200, 201):
        rep.bug("R", f"{code} · AN ORDER WAS CANCELLED TWICE", f"{oid}")
    else:
        rep.ok("R", f"{code} · an order cancels once", f"{status}")


def _rows(body: dict) -> list:
    data = body.get("data")

    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        return data["data"]

    return []
