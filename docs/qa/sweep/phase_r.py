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
from phase_a import ADMIN

# Stable, so a second run signs in rather than registering — `throttle:auth` is
# five per minute per IP and the sweep shares it with every other login.
SHOPPER = "sweep-shopper@qa.test"
OTHER = "sweep-shopper-two@qa.test"
PASSWORD = "password1234"


def run(api: Api, rep: Report, sold: dict, tenants: dict | None = None) -> dict:
    mine = _customer(api, rep, SHOPPER, "Sweep Shopper")
    theirs = _customer(api, rep, OTHER, "Sweep Shopper Two")

    if mine is None or theirs is None:
        rep.query("R", "a customer account", "could not register or sign in — nothing below ran")
        return sold

    _a_customer_is_not_staff(api, rep, mine)

    # A shop is only orderable when FOUR things are true at once — active,
    # `online_shop_enabled`, `setup_completed` and the `marketplace` module —
    # and the sweep's tenants have never needed the last two, because no phase
    # before this one was a shopper. One of nine was listed, so ordering was
    # driven against a grocery and nothing else: no restaurant order with
    # modifiers, no pharmacy order carrying a prescription item.
    #
    # Those are not variations on the same path. They are where the interesting
    # questions live.
    _open_for_shoppers(api, rep, sold, tenants or {})

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

        # Start from a shelf nothing is 86'd on. The sold-out check below puts
        # the flag back itself, but a run killed between the press and the
        # release would leave it set — and the ORDER checks come first, so the
        # next run would report a bug about a shop the sweep broke. The rule
        # this phase inherits is that every phase stays re-runnable.
        api.delete(f"/products/{state['product']['id']}/sold-out", token=state["token"])
        order = _an_order_is_priced_by_the_shop(api, rep, code, slug, state, mine)

        if order is None:
            continue

        _a_price_from_the_customer_is_ignored(api, rep, code, slug, state, mine)
        _an_order_cannot_reach_across_shops(api, rep, code, slug, mine, sold)
        _a_dish_taken_off_the_menu_is_not_sold(api, rep, code, slug, state, mine, state["product"])
        if state.get("features", {}).get("pharmacy") or code == "pharmacy":
            _a_prescription_is_not_sold_over_a_counter_nobody_is_at(api, rep, code, slug, state, mine)

        # Modifiers are a food capability in `ItemTypes` — a chemist refusing to
        # put "extra shot" on a medicine is the product working. So this is the
        # restaurant's question, and only the restaurant's.
        if code == "food_restaurant":
            _a_dish_is_made_the_way_it_was_ordered(api, rep, code, slug, state, mine)

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

def _open_for_shoppers(api: Api, rep: Report, sold: dict, tenants: dict) -> None:
    """
    Put a restaurant and a chemist on the marketplace, so ordering is driven
    against more than a grocery.

    Two switches, and they belong to two different people. The `marketplace`
    module is the platform's to grant — the same admin call phase F uses — and
    finishing setup is the shop's own. A sweep tenant has never needed either,
    because until this phase nobody ever shopped.

    Nothing here is a check. It is fixture-building, and it says so: a shop that
    will not open is a QUERY explaining which of the two switches refused, never
    a bug about the product.
    """
    if not tenants:
        return

    want = [c for c in ("food_restaurant", "pharmacy") if c in sold and c in tenants]
    if not want:
        return

    status, body = api.get("/cities")
    cities = _rows(body)
    city = cities[0].get("id") if status == 200 and cities else None

    if city is None:
        rep.query("R", "a city to finish shop setup with", f"/cities → {status}")
        return

    admin = api.login(ADMIN)

    for code in want:
        state = sold[code]
        features = dict(state.get("features") or {})

        if not features.get("marketplace"):
            status, body = api.put(
                f"/admin/tenants/{tenants[code]['id']}/modules",
                {"modules": {**features, "marketplace": True}},
                token=admin,
            )
            if status not in (200, 201):
                rep.query("R", f"{code} · put on the marketplace", f"{status} · {str(body)[:100]}")
                continue

        # The shop's own half. Idempotent: a shop already set up simply says so.
        status, body = api.put("/shop/setup", {"city_id": city}, token=state["token"])

        if status not in (200, 201):
            rep.query("R", f"{code} · finish shop setup", f"{status} · {str(body)[:100]}")


def _a_prescription_is_not_sold_over_a_counter_nobody_is_at(
    api: Api, rep: Report, code: str, slug: str, state: dict, token: str,
) -> None:
    """
    A PRESCRIPTION-ONLY MEDICINE, ORDERED BY A STRANGER ON A PHONE.

    At the counter a chemist looks at the paper. The whole point of
    `requires_prescription` is that somebody does. An online order has nobody
    standing there, and the request carries no prescription field at all — so
    if this is accepted, the shop is dispensing a scheduled drug to a name and
    an address on the strength of a tap.

    Nothing in the sweep had ever set this flag on a product, let alone tried to
    buy one. Recorded as a QUERY rather than a BUG when it goes through: a
    chemist confirming the prescription before handing the bag over is a
    legitimate design, and this phase cannot see that far. What it CAN say is
    whether the order was taken with nothing asked, which is the thing worth
    knowing either way.
    """
    status, body = api.post("/products", {
        "item_type": "medicine",
        "name": "Sweep Rx Only",
        "price": 300,
        "cost": 150,
        "tax_rate": 0,
        "track_inventory": True,
        "requires_prescription": True,
    }, token=state["token"])

    rx = (body.get("data") or {}) if status in (200, 201) else {}

    if not rx.get("id"):
        # Already there from an earlier run.
        status, body = api.get("/products?search=Sweep+Rx+Only", token=state["token"])
        rx = next((p for p in _rows(body) if p.get("name") == "Sweep Rx Only"), {})

    if not rx.get("id"):
        rep.query("R", f"{code} · a prescription-only item to try", "could not make one")
        return

    if not rx.get("requires_prescription"):
        rep.query("R", f"{code} · the item is marked prescription-only", "the flag did not stick")
        return

    # PUT IT ON THE SHELF FIRST.
    #
    # Otherwise the order is refused for having none, the check reads "not
    # ordered — 422" and goes green having tested the stock rule rather than the
    # prescription rule. The item was sitting at 0.000 the first time this ran,
    # and only reading the refusal's REASON showed which of the two had fired.
    api.post("/inventory/adjust", {
        "product_id": rx["id"], "type": "set", "new_quantity": 25,
        "reason": "QA sweep · so the refusal cannot be about stock",
    }, token=state["token"])

    status, body = api.post("/customer/orders", {
        "shop_slug": slug,
        "fulfillment_type": "delivery",
        "delivery_address": "12 Sweep Street",
        "items": [{"product_id": rx["id"], "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, token=token)

    if status in (200, 201):
        # A BUG rather than a query, because the product has declared this rule
        # itself: the refusal it normally gives carries `RX_IN_PERSON_ONLY` and
        # the words "please visit the pharmacy". A shop is entitled to decide
        # that a chemist checks the paper at handover instead — but this
        # codebase decided the opposite, and a check holds a product to its own
        # rule.
        rep.bug(
            "R", f"{code} · A PRESCRIPTION-ONLY MEDICINE WAS ORDERED WITH NOTHING ASKED",
            "accepted for delivery — no prescription field exists on the request, "
            "so the chemist has to catch this by hand or not at all",
        )
        return

    # A refusal is not enough. It has to be a refusal ABOUT THE PRESCRIPTION —
    # "out of stock" and "this shop is closed" are both 422s that would leave
    # this check green while proving nothing.
    said = f"{body.get('message') or ''} {(body.get('meta') or {}).get('error_code') or ''}".lower()

    if "prescription" in said or "rx_" in said:
        rep.ok("R", f"{code} · a prescription-only medicine is refused, and says why", f"{status}")
    else:
        rep.query(
            "R", f"{code} · a prescription-only medicine was refused for another reason",
            f"{status} · {said.strip()[:110] or 'nothing said'} — the prescription rule was not what stopped it",
        )


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


# ── the dish that is not only a dish ───────────────────────────────────

CRUST = "Sweep Crust"
EXTRAS = "Sweep Extras"


def _a_dish_is_made_the_way_it_was_ordered(api: Api, rep: Report, code: str, slug: str,
                                           state: dict, token: str) -> None:
    """
    A PIZZA ORDERED WITH STUFFED CRUST AND EXTRA CHEESE.

    Every other line in this phase is "this thing, n times". A modifier is the
    one place where the customer changes both the PRICE and the RECIPE, and it
    is the only part of an order where three separate things must all be true
    and each of them fails quietly on its own:

        SHOWN        the menu has to publish the choice, with what it costs.
                     A group with `min_select 1` that the shopfront never sends
                     is a dish nobody can order — the order is refused for
                     missing something the customer was never offered, which
                     reads to them as the shop being broken.

        CHARGED      the delta has to come off the SHOP's own option row. The
                     customer sends option ids and never a number, exactly as
                     they send product ids and never a price.

        REMEMBERED   the line has to carry what was chosen. If the snapshot is
                     empty the customer pays for stuffed crust and extra cheese
                     and the kitchen reads a plain pizza — the one failure here
                     that money alone would never reveal, because the total is
                     right.

    `ModifierResolver` is deliberately one implementation shared by the POS and
    the online order, which is the right design and is also why nothing here is
    about its arithmetic. Shared code diverges in what it is HANDED, not in what
    it does, and no sweep phase had ever handed it anything from the outside.

    Asked of the restaurant only. Modifiers are a food capability in
    `ItemTypes`, so a chemist refusing to put "extra shot" on a medicine is the
    product working, not a shop that failed to answer.
    """
    owner = state["token"]

    dish = _menu_item(api, rep, code, owner, "Sweep Pizza", 800)
    decoy = _menu_item(api, rep, code, owner, "Sweep Pizza Two", 900)

    if dish is None or decoy is None:
        rep.query("R", f"{code} · a dish to put choices on", "could not create one — nothing below ran")
        return

    saved = _put_choices(api, rep, code, owner, dish, [
        {"name": CRUST, "type": "modifier", "min_select": 1, "max_select": 1, "options": [
            {"name": "Thin", "price_delta": 0},
            {"name": "Stuffed", "price_delta": 200},
        ]},
        {"name": EXTRAS, "type": "addon", "min_select": 0, "max_select": 2, "options": [
            {"name": "Cheese", "price_delta": 100},
            {"name": "Olives", "price_delta": 50},
            {"name": "Jalapenos", "price_delta": 75},
        ]},
    ])

    # A second dish with a choice of its own, so "an option from somewhere else"
    # can be a REAL option rather than a made-up uuid. A random id proves the
    # lookup runs; another dish's id proves the fence is around this product.
    saved_decoy = _put_choices(api, rep, code, owner, decoy, [
        {"name": "Sweep Sauce", "type": "addon", "min_select": 0, "max_select": 1,
         "options": [{"name": "Garlic", "price_delta": 30}]},
    ])

    if not saved:
        return

    # Read the menu the way a customer meets it — no token, and only what the
    # shopfront chose to publish. Reaching behind the counter for the option ids
    # would make every check below pass on a menu that shows nothing.
    menu = _on_the_menu(api, slug, "Sweep Pizza")
    shown = menu.get(dish["id"])

    if shown is None:
        rep.query("R", f"{code} · the dish is on the public menu", "created but not listed — nothing below ran")
        return

    groups = shown.get("modifier_groups") or []
    options = [o for g in groups for o in (g.get("options") or [])]
    by_name = {o.get("name"): o for o in options}

    if len(groups) < 2 or len(options) < 5:
        rep.bug(
            "R", f"{code} · A DISH SHOWS ITS CHOICES ON THE MENU",
            f"the shop saved 2 groups and 5 options; the shopfront published {len(groups)} and {len(options)} "
            "— a required choice a customer cannot see is a dish they cannot order",
        )
        return

    rep.ok("R", f"{code} · the menu shows the choices", f"{len(groups)} groups · {len(options)} options")

    crust = next((g for g in groups if g.get("name") == CRUST), None)

    if crust is None or int(crust.get("min_select") or 0) < 1:
        rep.bug(
            "R", f"{code} · THE MENU SAYS WHICH CHOICE IS REQUIRED",
            f"{CRUST} was saved with min_select 1 and the menu shows "
            f"{crust.get('min_select') if crust else 'no such group'} — a customer has no way to know "
            "the order will be refused until it is",
        )
    else:
        rep.ok("R", f"{code} · the menu says which choice is required", f"{CRUST} · min {crust.get('min_select')}")

    stuffed, cheese = by_name.get("Stuffed"), by_name.get("Cheese")
    olives, jalapenos = by_name.get("Olives"), by_name.get("Jalapenos")

    if not all((stuffed, cheese, olives, jalapenos)):
        rep.query("R", f"{code} · the options came back by name", f"got {sorted(by_name)}")
        return

    # What a choice costs is on the menu, because the customer decides with it.
    if abs(float(stuffed.get("price_delta") or 0) - 200) > 0.01:
        rep.bug(
            "R", f"{code} · A CHOICE COSTS WHAT THE MENU SAYS",
            f"Stuffed was saved at +200 and the menu shows +{stuffed.get('price_delta')} — "
            "the bill and the menu disagree in front of the customer",
        )
    else:
        rep.ok("R", f"{code} · the menu prices each choice", "Stuffed +200")

    placed = _the_shop_charges_for_the_choices(api, rep, code, slug, token, shown, dish, stuffed, cheese)

    if placed is not None:
        _what_was_agreed_is_what_is_rung(api, rep, code, state, placed, float(shown.get("price") or 0))

    # A required group, skipped. Refused — and refused ABOUT THE CRUST: "out of
    # stock" and "this shop is shut" are both 422s that would leave this green
    # having proved nothing. The prescription check learned that the hard way.
    _a_choice_is_refused(
        api, rep, code, slug, token, dish["id"], [],
        what="a required choice cannot be skipped",
        words=("modifier_min", "at least"),
        title="A REQUIRED CHOICE WAS SKIPPED",
        why=f"ordered with nothing chosen from {CRUST} (min_select 1) and it was taken — "
            "the kitchen has to guess which crust, or ring the customer back",
    )

    # More extras than the group allows.
    _a_choice_is_refused(
        api, rep, code, slug, token, dish["id"],
        [stuffed["id"], cheese["id"], olives["id"], jalapenos["id"]],
        what="a group's limit holds",
        words=("modifier_max", "at most"),
        title="A GROUP'S LIMIT DID NOT HOLD",
        why=f"{EXTRAS} allows 2 and 3 were accepted",
    )

    # An option that belongs to a different dish.
    if saved_decoy:
        garlic = _an_option_of(_on_the_menu(api, slug, "Sweep Pizza Two").get(decoy["id"]), "Garlic")

        if garlic is None:
            rep.query("R", f"{code} · another dish's option to borrow", "the second dish published none")
        else:
            _a_choice_is_refused(
                api, rep, code, slug, token, dish["id"], [stuffed["id"], garlic],
                what="an option from another dish is refused",
                words=("modifier_invalid", "invalid option"),
                title="AN OPTION FROM ANOTHER DISH WAS ACCEPTED",
                why="a garlic sauce belonging to a different item was added to this one — "
                    "the fence is meant to be around THIS product's groups, not the shop's",
            )


def _the_shop_charges_for_the_choices(api: Api, rep: Report, code: str, slug: str, token: str,
                                      shown: dict, dish: dict, stuffed: dict, cheese: dict) -> dict | None:
    """
    Stuffed crust and extra cheese, ordered by id and never by price.

    Pickup on purpose: a delivery fee and a minimum basket would both land in
    `total` and there would be no way to tell a missing add-on from a free
    delivery. The line's own `unit_price` is the figure with nothing else in it.
    """
    base = float(shown.get("price") or 0)

    status, body = api.post("/customer/orders", {
        "shop_slug": slug,
        "fulfillment_type": "pickup",
        "items": [{
            "product_id": dish["id"],
            "quantity": 1,
            "modifier_option_ids": [stuffed["id"], cheese["id"]],
        }],
        "idempotency_key": str(uuid.uuid4()),
    }, token=token)

    if status not in (200, 201):
        rep.bug("R", f"{code} · A DISH CAN BE ORDERED WITH ITS CHOICES", f"{status} · {str(body)[:140]}")
        return None

    order = (body.get("data") or {})
    line = next(iter(order.get("items") or []), {})
    unit = float(line.get("unit_price") or 0)
    delta = round(unit - base, 2)

    if base <= 0:
        rep.query("R", f"{code} · the dish has a menu price to compare against", f"{base}")
    elif delta <= 0.01:
        rep.bug(
            "R", f"{code} · AN ADD-ON IS CHARGED FOR",
            f"stuffed crust (+200) and extra cheese (+100) on a {base} dish came to {unit} — "
            "the shop is giving the extras away on every online order",
        )
    elif abs(delta - 300) > 0.01:
        rep.query(
            "R", f"{code} · the add-ons are charged, but not at the menu's figures",
            f"expected +300 on a {base} dish and the line is {unit} (+{delta})",
        )
    else:
        rep.ok("R", f"{code} · the shop charges for the choices", f"{base} + 300 → {unit}")

    # THE ONE THAT MONEY CANNOT REVEAL. The total above can be right to the
    # rupee while the ticket the kitchen reads says nothing about a crust.
    chosen = " ".join(str(m) for m in (line.get("modifiers") or []))

    if "Stuffed" in chosen and "Cheese" in chosen:
        rep.ok("R", f"{code} · the order remembers what was chosen", chosen[:70])
    else:
        rep.bug(
            "R", f"{code} · AN ORDER REMEMBERS WHAT WAS CHOSEN",
            f"ordered stuffed crust and extra cheese; the line carries {chosen[:70] or 'nothing'} — "
            "the customer is charged for both and the kitchen makes a plain pizza",
        )

    return order


def _a_dish_taken_off_the_menu_is_not_sold(api: Api, rep: Report, code: str, slug: str,
                                           state: dict, token: str, item: dict) -> None:
    """
    EIGHT O'CLOCK, THE KARAHI RUNS OUT, AND THE COOK PRESSES 86.

    "Sold out" is not the same decision as "deactivated" — the codebase says so
    itself: deactivating is a CATALOG decision made once, and 86 is a SERVICE
    decision made mid-shift and undone when the next delivery lands. It has its
    own column, its own controller and its own button, and the till enforces it.

    Which leaves one question — MAY THIS BE SOLD RIGHT NOW — and two places that
    answer it: the counter, and the app. This phase is the first thing that has
    ever asked the app.

    Asked of every shop, not only the restaurant. The button is gated on
    `products.manage` and nothing else, and a mart that runs out of milk at
    seven has exactly the same evening.

    Three parts, and the third is the one that makes the first two mean
    anything:

        THE COUNTER   refuses. Asked in the same breath, so a disagreement is
                      recorded as a disagreement rather than as an opinion.

        THE APP       must refuse too, and say the same thing.

        PUT IT BACK   the 86 is lifted and the same order goes through. Without
                      this the check cannot tell "refused because it is sold
                      out" from "refused because this shop is shut" — the
                      refusal has to be CAUSED by the flag, not merely coincide
                      with it.
    """
    owner = state["token"]
    pid = item["id"]

    status, body = api.post(f"/products/{pid}/sold-out", {}, token=owner)

    if status not in (200, 201):
        rep.query("R", f"{code} · a dish can be taken off the menu", f"{status} · {str(body)[:110]}")
        return

    try:
        # The counter, asked first. Its answer is corroboration, not the
        # verdict: a closed drawer or a shut shift is its own 422 and would
        # otherwise read as agreement.
        till, till_body = api.post("/sales", {
            "channel": "pos",
            "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "cash",
            "amount_paid": 100000,
        }, token=owner)
        till_said = f"{till_body.get('message') or ''} {(till_body.get('meta') or {}).get('error_code') or ''}".lower()
        counter_refused = till not in (200, 201) and ("sold out" in till_said or "item_sold_out" in till_said)

        # The customer's menu. A shop that cannot say "sold out for today" makes
        # the customer find out at checkout, which is the moment they had
        # already decided to spend.
        shown = _on_the_menu(api, slug, item.get("name") or "").get(pid) or {}
        flag = shown.get("sold_out")

        if flag is None:
            rep.query(
                "R", f"{code} · the public menu says what is sold out",
                "no sold-out field is published, so the storefront cannot grey the item out — "
                "the customer meets the refusal at checkout instead",
            )
        elif flag is not True:
            rep.bug(
                "R", f"{code} · THE MENU SAYS WHAT IS SOLD OUT",
                f"the dish is 86'd and the menu publishes sold_out={flag!r} — the app shows it as available",
            )
        else:
            rep.ok("R", f"{code} · the menu says what is sold out")

        status, body = api.post("/customer/orders", {
            "shop_slug": slug,
            "fulfillment_type": "pickup",
            "items": [{"product_id": pid, "quantity": 1}],
            "idempotency_key": str(uuid.uuid4()),
        }, token=token)

        if status in (200, 201):
            rep.bug(
                "R", f"{code} · A DISH TAKEN OFF THE MENU WAS ORDERED ANYWAY",
                "the kitchen pressed 86 and the online order was accepted"
                + (" — the counter refused the very same item" if counter_refused else "")
                + ". Every order taken after that has to be rung back and cancelled by hand",
            )
            return

        said = f"{body.get('message') or ''} {(body.get('meta') or {}).get('error_code') or ''}".lower()

        if "sold out" not in said and "item_sold_out" not in said:
            rep.query(
                "R", f"{code} · a sold-out dish was refused for another reason",
                f"{status} · {said.strip()[:110] or 'nothing said'} — the 86 was not what stopped it",
            )
            return

        rep.ok("R", f"{code} · a dish taken off the menu is not sold", f"{status}")

    finally:
        api.delete(f"/products/{pid}/sold-out", token=owner)

    # BACK ON THE MENU. The refusal above has to be the flag's doing, and this
    # is the only thing that can tell.
    status, _ = api.post("/customer/orders", {
        "shop_slug": slug,
        "fulfillment_type": "pickup",
        "items": [{"product_id": pid, "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, token=token)

    if status in (200, 201):
        rep.ok("R", f"{code} · putting it back makes it orderable again")
    else:
        rep.query(
            "R", f"{code} · putting it back makes it orderable again",
            f"{status} — the refusal above may not have been about the 86 at all",
        )


def _what_was_agreed_is_what_is_rung(api: Api, rep: Report, code: str, state: dict,
                                     order: dict, base: float) -> None:
    """
    THE SHOP ACCEPTS THE ORDER, AND THE TILL RINGS SOMETHING ELSE.

    Completing an online order builds a real Sale, and it does it down the
    `trusted_prices` branch — the one that carries the captured `unit_price` and
    the captured `modifiers` forward instead of asking `ModifierResolver` again.
    That branch exists for two reasons written into the code, and both of them
    are failures nobody would see from the customer's side:

        RE-PRICE     re-running the resolver adds the +300 to a price that
                     already contains it. The customer agreed to 1100 and is
                     charged 1400, three days after they ate.

        RE-VALIDATE  re-running it re-checks `min_select` on a line whose
                     option ids are long gone from the payload, and a required
                     crust rejects an order the shop has already cooked.

    A deliberate branch with a comment explaining itself is worth exactly as
    much as the test that drives it, and this one has never been driven from the
    outside by anything. The customer's half of the question is the one that
    matters: what was agreed at checkout has to be what the till rings.
    """
    oid, owner = order.get("id"), state["token"]
    agreed = float(order.get("total") or 0)

    if not oid or agreed <= 0:
        return

    # Pickup: pending → confirmed → preparing → ready → completed. Advancing is
    # the shop's own screen, so it is the owner's token, not the customer's.
    for step in ("confirmed", "preparing", "ready", "completed"):
        status, body = api.post(f"/orders/{oid}/advance", {"status": step}, token=owner)

        if status not in (200, 201):
            # A refusal AT `completed` is the interesting one — that is the
            # required group rejecting an order the shop already accepted.
            if step == "completed":
                rep.bug(
                    "R", f"{code} · AN ORDER WITH A REQUIRED CHOICE CAN BE COMPLETED",
                    f"{status} · {str(body)[:130]} — the shop cannot ring a dish it has already made",
                )
            else:
                rep.query("R", f"{code} · an order can be walked to {step}", f"{status} · {str(body)[:100]}")
            return

    done = (body.get("data") or {})
    sale = done.get("sale") or {}
    sale_id = done.get("sale_id") or sale.get("id")

    if not sale_id:
        rep.bug("R", f"{code} · A COMPLETED ORDER BECOMES A SALE", f"no sale on order {oid}")
        return

    status, body = api.get(f"/sales/{sale_id}", token=owner)

    if status != 200:
        rep.query("R", f"{code} · the sale behind a completed order can be read", f"{status}")
        return

    rung = (body.get("data") or {})
    total = float(rung.get("total") or 0)

    if abs(total - agreed) <= 0.01:
        rep.ok("R", f"{code} · the till rings what the customer agreed to", f"{total}")
    elif total > agreed + 0.01:
        rep.bug(
            "R", f"{code} · A COMPLETED ORDER WAS RE-PRICED UPWARDS",
            f"the customer agreed to {agreed} and the sale rings {total} — the add-on delta on a "
            f"{base} dish looks to have been counted twice",
        )
    else:
        rep.bug(
            "R", f"{code} · A COMPLETED ORDER LOST WHAT THE CUSTOMER PAID FOR",
            f"the customer agreed to {agreed} and the sale rings {total} — the shop is out of pocket "
            "by the extras on every online order it completes",
        )

    # The snapshot has to survive the hop too. This is the receipt the customer
    # is handed and the line a return is worked out from: "1 × Pizza 1100" with
    # no crust on it is a refund argument waiting to happen.
    line = next(iter(rung.get("items") or []), {})
    kept = " ".join(str(m) for m in (line.get("modifiers") or []))

    if "Stuffed" in kept and "Cheese" in kept:
        rep.ok("R", f"{code} · the sale line keeps what was chosen", kept[:70])
    else:
        rep.bug(
            "R", f"{code} · A SALE LINE KEEPS WHAT WAS CHOSEN",
            f"the order carried stuffed crust and extra cheese; the sale line carries "
            f"{kept[:70] or 'nothing'} — the receipt charges {total} and itemises none of it",
        )


def _a_choice_is_refused(api: Api, rep: Report, code: str, slug: str, token: str, product_id: str,
                         option_ids: list, what: str, words: tuple, title: str, why: str) -> None:
    """
    A selection that must not be taken — and a refusal that has to NAME the rule
    it enforced, or the check is green on somebody else's 422.
    """
    status, body = api.post("/customer/orders", {
        "shop_slug": slug,
        "fulfillment_type": "pickup",
        "items": [{"product_id": product_id, "quantity": 1, "modifier_option_ids": option_ids}],
        "idempotency_key": str(uuid.uuid4()),
    }, token=token)

    if status in (200, 201):
        rep.bug("R", f"{code} · {title}", why)
        return

    said = f"{body.get('message') or ''} {(body.get('meta') or {}).get('error_code') or ''}".lower()

    if any(w in said for w in words):
        rep.ok("R", f"{code} · {what}", f"{status} · {said.strip()[:60]}")
    else:
        rep.query(
            "R", f"{code} · {what} — refused for another reason",
            f"{status} · {said.strip()[:110] or 'nothing said'} — the rule under test was not what stopped it",
        )


def _menu_item(api: Api, rep: Report, code: str, owner: str, name: str, price: float) -> dict | None:
    status, body = api.post("/products", {
        "item_type": "food_item",
        "name": name,
        "price": price,
        "cost": round(price / 2, 2),
        "tax_rate": 0,
        # A dish that keeps no stock, deliberately. "None left" and "choose a
        # crust" are both 422s, and a refusal for the wrong reason is how the
        # prescription check spent its first run testing the stock rule.
        "track_inventory": False,
    }, token=owner)

    made = (body.get("data") or {}) if status in (200, 201) else {}

    if made.get("id"):
        return made

    # Left over from an earlier run.
    status, body = api.get(f"/products?search={name.replace(' ', '+')}", token=owner)

    return next((p for p in _rows(body) if p.get("name") == name), None)


def _put_choices(api: Api, rep: Report, code: str, owner: str, product: dict, groups: list) -> bool:
    status, body = api.put(f"/products/{product['id']}/modifier-groups", {"groups": groups}, token=owner)

    if status in (200, 201):
        return True

    rep.query("R", f"{code} · choices saved on {product.get('name')}", f"{status} · {str(body)[:110]}")

    return False


def _on_the_menu(api: Api, slug: str, search: str) -> dict:
    """The public menu, asked with no token — which is all a customer has."""
    status, body = api.get(f"/marketplace/shops/{slug}/products?search={search.replace(' ', '+')}&per_page=100")

    return {p["id"]: p for p in _rows(body) if p.get("id")} if status == 200 else {}


def _an_option_of(product: dict | None, name: str) -> str | None:
    for group in (product or {}).get("modifier_groups") or []:
        for option in group.get("options") or []:
            if option.get("name") == name:
                return option.get("id")

    return None


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
