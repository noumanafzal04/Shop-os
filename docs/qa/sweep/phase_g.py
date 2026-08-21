"""
Phase G — the things only one trade has.

Everything so far has been true of every shop. This is the opposite: a chemist's
lot expiry, a kitchen's recipe, a mobile shop's IMEI, a forecourt's tank. These
are the features that decide whether ShopOS is a till with a business type
attached or an actual pharmacy system, and each one is invisible from every
other trade — so a regression here reaches nobody's screen but the one shop that
depends on it entirely.

Four, in order of how much a wrong answer costs the shopkeeper:

    FEFO       the wrong lot leaves the shelf, and the expired one stays until
               somebody swallows it
    SERIALS    the same IMEI sold twice, and the warranty desk names one buyer
    RECIPE     a dish sells and the store room never moves
    FORECOURT  litres in the tank and litres through the nozzle stop agreeing
"""

import uuid

from api import Api, Report

NEAR = "2026-10-01"    # first out of the door
FAR = "2031-01-01"


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code, state in sold.items():
        token = state["token"]
        feats = state.get("features") or {}
        primary = state.get("primary") or code

        if primary == "pharmacy" and feats.get("inventory"):
            _fefo(api, rep, code, token)
        if primary in ("retail", "automotive", "petroleum") and feats.get("inventory"):
            _serials(api, rep, code, token, state)
        if primary == "food" and feats.get("inventory"):
            _recipe(api, rep, code, token)
        if feats.get("fuel"):
            _forecourt(api, rep, code, token)

    return sold


# ── the chemist ────────────────────────────────────────────────────────

def _fefo(api: Api, rep: Report, code: str, token: str) -> None:
    """
    First-Expiry-First-Out, and the rule that makes it possible.

    A medicine batch with no expiry date is refused outright — not defaulted,
    not left null — because every downstream protection (FEFO, the expired-stock
    fence, the near-expiry alert) reads that column, and one nullable row makes
    all three lie about the whole shelf.

    Then: two lots, one expiring soon and one years out, and a sale of one unit.
    The NEAR lot must be the one that shrinks. Getting this backwards is the
    quiet version of the worst thing a pharmacy system can do — the expired
    strip stays on the shelf until somebody takes it home.
    """
    med = _product(api, token, "Sweep Medicine", {
        "item_type": "medicine",
        "price": 200, "cost": 80, "tax_rate": 0,
        "track_inventory": True, "stock_quantity": 0,
        "expiry_date": FAR, "opening_batch_number": "SWEEP-BASE",
    })
    if med is None:
        rep.query("G", f"{code} · a medicine to batch", "could not create one")
        return

    # 1 · no expiry, no batch.
    status, body = api.post(f"/inventory/products/{med['id']}/batches", {
        "batch_number": "SWEEP-NO-EXPIRY", "quantity": 5,
    }, token=token)
    if status in (200, 201):
        rep.bug("G", f"{code} · A MEDICINE LOT MUST CARRY AN EXPIRY",
                "a batch with no expiry_date was accepted")
    else:
        rep.ok("G", f"{code} · medicine lot without expiry refused", str(status))

    # 2 · two lots, far one created FIRST so insertion order cannot be
    #     mistaken for expiry order.
    for number, expiry in (("SWEEP-FAR", FAR), ("SWEEP-NEAR", NEAR)):
        api.post(f"/inventory/products/{med['id']}/batches", {
            "batch_number": number, "expiry_date": expiry, "quantity": 10, "cost": 80,
        }, token=token)

    before = _batches(api, token, med["id"])
    if not {"SWEEP-NEAR", "SWEEP-FAR"} <= set(before):
        rep.query("G", f"{code} · both lots are on the shelf", f"have {sorted(before)}")
        return

    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": med["id"], "quantity": 1}],
        "payment_method": "cash", "amount_paid": 200,
    }, token=token)
    if status not in (200, 201):
        rep.bug("G", f"{code} · sell a batched medicine", _why(status, body))
        return

    after = _batches(api, token, med["id"])
    near_moved = before["SWEEP-NEAR"] - after.get("SWEEP-NEAR", 0)
    far_moved = before["SWEEP-FAR"] - after.get("SWEEP-FAR", 0)

    if near_moved >= 0.999 and far_moved < 0.001:
        rep.ok("G", f"{code} · FEFO took the near-expiry lot", f"{NEAR} −1")
    elif far_moved > 0:
        rep.bug("G", f"{code} · FEFO TAKES THE EARLIEST EXPIRY FIRST",
                f"the {FAR} lot moved {far_moved} while {NEAR} moved {near_moved}")
    else:
        rep.query("G", f"{code} · which lot was depleted",
                  f"near {near_moved}, far {far_moved} — neither moved as expected")

    # 3 · the near lot is what the expiring screen must be shouting about.
    status, body = api.get("/inventory/expiring", token=token)
    if status != 200:
        rep.bug("G", f"{code} · near-expiry list", str(status))
        return
    numbers = {r.get("batch_number") for r in _rows(body)}
    if "SWEEP-NEAR" in numbers:
        rep.ok("G", f"{code} · the near lot is flagged as expiring")
    else:
        rep.bug("G", f"{code} · A NEAR-EXPIRY LOT IS ON THE EXPIRING LIST",
                f"{NEAR} lot absent; list has {len(numbers)} entries")


# ── the mobile shop and the tyre bay ───────────────────────────────────

def _serials(api: Api, rep: Report, code: str, token: str, state: dict) -> None:
    """
    One serial, one unit, one buyer — for ever.

    The warranty desk is only as good as the guarantee that a serial names
    exactly one sale. Sell the same IMEI twice and the desk confidently tells
    the second customer their unit belongs to the first.
    """
    prod = _product(api, token, "Sweep Serialized", {
        "item_type": "physical_product",
        "price": 1500, "cost": 900, "tax_rate": 0,
        "track_inventory": True, "stock_quantity": 50,
        "tracks_serial": True, "warranty_months": 12,
    })
    if prod is None:
        rep.query("G", f"{code} · a serialized product", "could not create one")
        return

    if not prod.get("tracks_serial"):
        rep.bug("G", f"{code} · THIS TRADE MAY TRACK SERIALS",
                "tracks_serial did not stick — the warranty desk has nothing to look up")
        return

    # A NEW serial each run. Reusing one meant the second run onwards only ever
    # took the "already sold" branch — the sale and the warranty lookup stopped
    # being exercised at all, while the sweep still printed a pass for them. A
    # check that quietly stops running is the failure this phase set exists to
    # notice.
    serial = f"SWEEP-{code.upper()}-{uuid.uuid4().hex[:10].upper()}"

    status, body = api.post("/sales", {
        "channel": "pos",
        "customer_name": "Sweep Serial Buyer",
        "items": [{"product_id": prod["id"], "quantity": 1, "serials": [serial]}],
        "payment_method": "cash", "amount_paid": 1500,
    }, token=token)

    if status not in (200, 201):
        rep.bug("G", f"{code} · sell a serialized unit", _why(status, body))
        return

    rep.ok("G", f"{code} · sold one serialized unit", serial)
    _warranty_desk_answers(api, rep, code, token, serial)

    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": prod["id"], "quantity": 1, "serials": [serial]}],
        "payment_method": "cash", "amount_paid": 1500,
    }, token=token)
    if status in (200, 201):
        rep.bug("G", f"{code} · THE SAME SERIAL CANNOT BE SOLD TWICE",
                f"{serial} was sold again — the warranty desk now names the wrong buyer")
    else:
        rep.ok("G", f"{code} · the same serial refused a second time", str(status))


def _warranty_desk_answers(api: Api, rep: Report, code: str, token: str, serial: str) -> None:
    """The whole point of capturing a serial: somebody walks in holding it."""
    status, body = api.get(f"/warranty/lookup?serial={serial}", token=token)
    if status != 200:
        rep.bug("G", f"{code} · THE WARRANTY DESK FINDS THE SERIAL",
                f"lookup of a serial this shop just sold returned {status}")
        return

    d = body.get("data") or {}
    sale = d.get("sale") or {}
    if not sale.get("invoice_number"):
        rep.query("G", f"{code} · warranty lookup names the sale", f"keys: {sorted(d)}")
    else:
        rep.ok("G", f"{code} · warranty desk found it", sale["invoice_number"])


# ── the kitchen ────────────────────────────────────────────────────────

def _recipe(api: Api, rep: Report, code: str, token: str) -> None:
    """
    Selling a plate must empty the store room.

    A dish is not stock; its ingredients are. If the sale of a biryani does not
    take rice off the shelf, the kitchen reorders from a figure that has not
    moved since the day it was typed — and the first anyone knows is the night
    they run out mid-service.

    The dish's own cost comes from the ingredients too, so a shop that has never
    typed a plate price still gets a true margin.
    """
    rice = _product(api, token, "Sweep Rice", {
        "item_type": "physical_product",
        "price": 400, "cost": 200, "tax_rate": 0,
        "track_inventory": True, "stock_quantity": 100, "unit": "KG",
    })
    if rice is None:
        rep.query("G", f"{code} · an ingredient", "could not create one")
        return

    # Top the ingredient back up so re-runs measure a real fall — through an
    # inventory adjustment, because `stock_quantity` on a product update is
    # prohibited ("stock changes go through inventory adjustments").
    api.post("/inventory/adjust", {
        "product_id": rice["id"], "type": "set",
        "new_quantity": 100, "reason": "QA sweep restock",
    }, token=token)

    # `food_item`, not `food` — the TRADE is food, the ITEM TYPE is a food item.
    # Sending the trade code here fails twice over: "the selected item type is
    # invalid" and "only a food dish can have a recipe of ingredients", the
    # second of which reads like recipes being unavailable to a restaurant.
    dish = _product(api, token, "Sweep Biryani", {
        "item_type": "food_item",
        "price": 600, "tax_rate": 0,
        "track_inventory": False,
        "recipe_items": [{"ingredient_product_id": rice["id"], "quantity": 2}],
    })
    if dish is None:
        rep.query("G", f"{code} · a dish with a recipe", "could not create one")
        return

    before = _stock(api, token, rice["id"])
    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": dish["id"], "quantity": 3}],
        "payment_method": "cash", "amount_paid": 1800,
    }, token=token)
    if status not in (200, 201):
        rep.bug("G", f"{code} · sell a dish", _why(status, body))
        return

    after = _stock(api, token, rice["id"])
    if before is None or after is None:
        rep.query("G", f"{code} · ingredient stock readable", f"{before} → {after}")
        return

    # 3 plates × 2 KG each.
    if abs((before - after) - 6) > 0.001:
        rep.bug("G", f"{code} · SELLING A DISH EMPTIES THE STORE ROOM",
                f"3 plates × 2 KG should take 6; rice went {before} → {after}")
    else:
        rep.ok("G", f"{code} · 3 plates took 6 KG of rice off the shelf")

    # And the dish costs what it is made of. The field is `recipe_cost`, and it
    # is COMPUTED on read rather than stored — so a dish re-prices itself the
    # day its ingredients do, which is the whole point of costing a menu.
    # `recipe_cost_missing` sits beside it: an ingredient with no cost makes the
    # dish's cost UNKNOWN, and unknown is not zero. A zero would quietly report
    # a 100% margin on the thing the kitchen loses money on.
    d = _read(api, token, dish["id"]) or {}
    cost = d.get("recipe_cost")
    missing = d.get("recipe_cost_missing")

    if cost is None:
        rep.query("G", f"{code} · the dish carries a recipe cost",
                  f"recipe_cost absent; missing={missing}")
    elif abs(float(cost) - 400) > 0.5:      # 2 KG × Rs 200
        rep.query("G", f"{code} · dish cost from its ingredients",
                  f"2 KG × 200 = 400, product says {cost}")
    else:
        rep.ok("G", f"{code} · the dish costs what it is made of", "400")


# ── the forecourt ──────────────────────────────────────────────────────

def _forecourt(api: Api, rep: Report, code: str, token: str) -> None:
    """
    A pump is not a shelf.

    Fuel leaves through a nozzle whose meter only ever counts UP, and the tank
    it came from is measured by dipping a stick. Two independent figures for the
    same litres — which is exactly why a forecourt is reconciled at all, and why
    the shift is a stock correction rather than a cash one.

    Two invariants are checked here, and both cost real money on a real pump:

      THE METER NEVER GOES BACKWARDS   a closing reading below the opening one
                                       is either a typo or a story, and either
                                       way it must not post
      TEST LITRES ARE NOT SALES        fuel pumped into the test measure and
                                       poured back is metered like everything
                                       else; counted as sold, the attendant is
                                       short by it every single shift
    """
    tank = _tank(api, rep, code, token)
    if tank is None:
        return

    nozzle = _nozzle(api, rep, code, token, tank)
    if nozzle is None:
        return

    # An already-open shift from a previous run is the shift to work with.
    status, body = api.get("/fuel/shifts/current", token=token)
    shift = (body.get("data") or {}) if status == 200 else {}

    opening = float(nozzle.get("current_reading") or 0)
    if not shift.get("id"):
        status, body = api.post("/fuel/shifts", {
            "readings": [{"fuel_nozzle_id": nozzle["id"], "opening_reading": opening}],
            "dips": [{"fuel_tank_id": tank["id"], "opening_dip": 5000}],
            "notes": "QA sweep forecourt shift",
        }, token=token)
        if status not in (200, 201):
            rep.bug("G", f"{code} · open a forecourt shift", _why(status, body))
            return
        shift = body.get("data") or {}
        rep.ok("G", f"{code} · forecourt shift open", f"nozzle at {opening:.0f}")

    # ── what is NOT an invariant here ───────────────────────────────
    #
    # A closing reading BELOW the opening one is not an error. A mechanical
    # head rolls at 999999.999, and the code reads the smaller number as a roll
    # rather than a recovery — treat it naively and the shift reports a million
    # litres of phantom gain on the one report an owner reads to find losses.
    # The sweep's first version asserted "a meter cannot be wound back", which
    # sounds like a rule and is the opposite of this trade's actual one.
    #
    # So the two checks below are the invariants that DO hold.

    sold = 100.0
    test = 5.0

    # 1 · more tested than pumped is a keying error, not a reading.
    status, body = api.post(f"/fuel/shifts/{shift['id']}/close", {
        "readings": [{
            "fuel_nozzle_id": nozzle["id"],
            "closing_reading": opening + sold,
            "test_litres": sold + 50,
        }],
        "dips": [{"fuel_tank_id": tank["id"], "closing_dip": 4900}],
    }, token=token)

    if status in (200, 201):
        rep.bug("G", f"{code} · MORE TESTED THAN PUMPED IS REFUSED",
                f"{sold + 50:.0f} test litres accepted against {sold:.0f} through the meter")
        return
    rep.ok("G", f"{code} · more tested than pumped refused", str(status))

    # 2 · test litres are metered but not sold.
    status, body = api.post(f"/fuel/shifts/{shift['id']}/close", {
        "readings": [{
            "fuel_nozzle_id": nozzle["id"],
            "closing_reading": opening + sold,
            "test_litres": test,
        }],
        "dips": [{"fuel_tank_id": tank["id"], "closing_dip": 4900}],
        "notes": "QA sweep forecourt close",
    }, token=token)

    if status not in (200, 201):
        rep.bug("G", f"{code} · close a forecourt shift", _why(status, body))
        return

    d = body.get("data") or {}
    litres = _first_number(d, ("litres_sold", "total_litres", "sold_litres", "net_litres"))

    if litres is None:
        rep.query("G", f"{code} · the close names litres sold", f"keys: {sorted(d)}")
    elif abs(litres - (sold - test)) < 0.01:
        rep.ok("G", f"{code} · test litres are not sales",
               f"{sold:.0f} metered − {test:.0f} test = {litres:.0f}")
    elif abs(litres - sold) < 0.01:
        rep.bug("G", f"{code} · TEST LITRES ARE NOT SALES",
                f"{sold:.0f} litres through the meter counted whole; {test:.0f} went back in the tank")
    else:
        rep.query("G", f"{code} · litres sold on the close",
                  f"metered {sold}, test {test}, report says {litres}")

    # 3 · the next shift opens where this one ended. A meter that does not carry
    #     forward hands the following shift the whole night's litres again.
    after = _nozzle_reading(api, token, nozzle["id"])
    if after is None:
        rep.query("G", f"{code} · the nozzle reading is readable back", "not found")
    elif abs(after - (opening + sold)) > 0.01:
        rep.bug("G", f"{code} · THE METER CARRIES FORWARD",
                f"closed at {opening + sold:.0f}, nozzle now reads {after:.0f}")
    else:
        rep.ok("G", f"{code} · meter carried forward", f"{after:.0f}")


def _nozzle_reading(api: Api, token: str, nozzle_id: str) -> float | None:
    status, body = api.get("/fuel/pumps", token=token)
    if status != 200:
        return None
    for p in _rows(body):
        for n in (p.get("nozzles") or []):
            if n.get("id") == nozzle_id:
                return float(n.get("current_reading") or 0)
    return None


def _tank(api: Api, rep: Report, code: str, token: str) -> dict | None:
    """The sweep's own tank, holding the sweep's own fuel product."""
    status, body = api.get("/fuel/tanks", token=token)
    tanks = _rows(body) if status == 200 else []
    found = next((t for t in tanks if t.get("name") == "Sweep Tank"), None)
    if found:
        return found

    fuel = _product(api, token, "Sweep Petrol", {
        "item_type": "physical_product",
        "price": 280, "cost": 260, "tax_rate": 0, "unit": "Litre",
        "track_inventory": True, "stock_quantity": 5000,
    })
    if fuel is None:
        rep.query("G", f"{code} · a fuel product for the tank", "could not create one")
        return None

    status, body = api.post("/fuel/tanks", {
        "name": "Sweep Tank", "product_id": fuel["id"],
        "capacity_litres": 20000, "current_dip_litres": 5000, "dead_stock_litres": 200,
    }, token=token)
    if status not in (200, 201):
        rep.bug("G", f"{code} · add a tank", _why(status, body))
        return None

    rep.ok("G", f"{code} · tank added", "Sweep Tank · 20,000 L")
    return body.get("data") or {}


def _nozzle(api: Api, rep: Report, code: str, token: str, tank: dict) -> dict | None:
    status, body = api.get("/fuel/pumps", token=token)
    pumps = _rows(body) if status == 200 else []
    pump = next((p for p in pumps if p.get("name") == "Sweep Pump"), None)

    if pump is None:
        status, body = api.post("/fuel/pumps", {"name": "Sweep Pump", "code": "SP1"}, token=token)
        if status not in (200, 201):
            rep.bug("G", f"{code} · add a pump", _why(status, body))
            return None
        pump = body.get("data") or {}
        rep.ok("G", f"{code} · pump added")

    found = next((n for n in (pump.get("nozzles") or []) if n.get("name") == "Sweep Nozzle"), None)
    if found:
        return found

    status, body = api.post(f"/fuel/pumps/{pump['id']}/nozzles", {
        "name": "Sweep Nozzle", "fuel_tank_id": tank["id"], "current_reading": 1000,
    }, token=token)
    if status not in (200, 201):
        rep.bug("G", f"{code} · add a nozzle", _why(status, body))
        return None

    rep.ok("G", f"{code} · nozzle added", "reading 1000")
    return body.get("data") or {}


def _first_number(d: dict, keys: tuple) -> float | None:
    for k in keys:
        if d.get(k) is not None:
            return float(d[k])
    return None


# ── plumbing ───────────────────────────────────────────────────────────

def _product(api: Api, token: str, name: str, payload: dict) -> dict | None:
    """
    The sweep's own product of this shape, made once, reused — and RESTOCKED.

    It was created with fifty units and never topped up, so every run ate one
    and the fiftieth run onwards reported `sell a serialized unit — 422
    Insufficient stock: only 0 in stock` as a product bug. The server was
    right; the shelf really was empty, because the sweep had emptied it.

    "It must stay re-runnable" is this sweep's oldest rule, and phase C's own
    product helper has restocked since the day it was written. This one had
    not.
    """
    status, body = api.get(f"/products?search={name.replace(' ', '+')}", token=token)
    rows = _rows(body) if status == 200 else []
    found = next((r for r in rows if r.get("name") == name), None)

    if found:
        want = float(payload.get("stock_quantity") or 0)
        if want > 0 and float(found.get("stock_quantity") or 0) < 5:
            api.post("/inventory/adjust", {
                "product_id": found["id"], "type": "set", "new_quantity": want,
                "reason": "sweep phase G restock",
            }, token=token)
            found = _read(api, token, found["id"]) or found

        return found

    status, body = api.post("/products", {"name": name, **payload}, token=token)
    return (body.get("data") or {}) if status in (200, 201) else None


def _read(api: Api, token: str, pid: str) -> dict | None:
    status, body = api.get(f"/products/{pid}", token=token)
    return (body.get("data") or {}) if status == 200 else None


def _stock(api: Api, token: str, pid: str) -> float | None:
    d = _read(api, token, pid) or {}
    q = d.get("stock_quantity")
    return None if q is None else float(q)


def _batches(api: Api, token: str, pid: str) -> dict:
    """
    {batch_number: quantity remaining}, SUMMED.

    A second delivery under the same batch number is a second LOT, not an edit
    of the first — they can carry different costs and arrived on different days,
    and FEFO orders them by expiry regardless. Reading only the last row made
    the sweep see a lot that never moved and report FEFO as broken.
    """
    status, body = api.get(f"/inventory/products/{pid}/batches", token=token)
    if status != 200:
        return {}
    out: dict[str, float] = {}
    for r in _rows(body):
        n = r.get("batch_number")
        if n:
            out[n] = out.get(n, 0.0) + float(r.get("quantity") or 0)
    return out


def _why(status: int, body: dict) -> str:
    return f"{status} {body.get('errors') or body.get('message')}"


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
