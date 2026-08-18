"""
Phase B — what each trade is actually given.

One shop per business type, logged in as its own owner, asked the questions a
shopkeeper's first hour asks: what may I put in my catalog, what units does this
trade measure in, what does a product of my kind need?

The three gating axes are the whole subject. A finding here is almost always one
of them being read where another was meant:

    MODULE   tenants.features    "does this shop have it?"
    TRADE    business_type       "what kind of business is this?"
    PERSON   permissions         "may this person do it?"
"""

from api import Api, Report

# What each trade must be able to put in its catalog, and what it must not.
# `must_not` is the half that finds real bugs: offering a salon a physical
# product it cannot stock, or a books-only shop a catalog at all.
EXPECT = {
    "food":       {"must": ["physical_product"], "must_not": []},
    "mart":       {"must": ["physical_product"], "must_not": []},
    "pharmacy":   {"must": ["medicine"],         "must_not": []},
    "retail":     {"must": ["physical_product"], "must_not": []},
    "services":   {"must": ["service"],          "must_not": []},
    "automotive": {"must": [],                   "must_not": []},
    "finance":    {"must": [],                   "must_not": []},
    "petroleum":  {"must": [],                   "must_not": []},
    # The one shop in the sweep with a business_category that DOES something:
    # food + `restaurant` arrives with the inventory module, which is what a
    # recipe needs before it can deplete anything.
    "food_restaurant": {"must": ["physical_product"], "must_not": []},
}


def run(api: Api, rep: Report, tenants: dict) -> dict:
    """Logs in as each owner, records what its trade offers. Returns tokens."""
    shops: dict[str, dict] = {}

    # One fetch, reused by every shop. Public route, no token needed.
    _, body = api.get("/business-types")
    catalog = {t["code"]: t for t in (body.get("data") or []) if isinstance(t, dict)}

    for code, t in tenants.items():
        token = api.login(t["email"])
        if token is None:
            rep.bug("B", f"{code} · owner can log in", t["email"])
            continue

        shop = {"token": token, "id": t["id"]}

        # ── what this shop believes about itself ────────────────────────
        status, body = api.get("/auth/me", token=token)
        me = (body.get("data") or {})
        tenant = me.get("tenant") or {}

        if status != 200:
            rep.bug("B", f"{code} · /auth/me", f"{status}")
            continue

        rep.ok("B", f"{code} · owner can log in")

        # `business_type_primary` is the gate. The raw code is for display, and
        # anything deciding what the business IS must read the primary — an
        # older code (clinic, workshop, grocery) resolves to the type that
        # absorbed it, and reading the raw one locks those shops out.
        primary = tenant.get("business_type_primary")
        expected = t.get("primary", code)
        if primary != expected:
            rep.query("B", f"{code} · primary type", f"got {primary!r}, expected {expected!r}")

        # ── item types: trade × MODULES, not the trade alone ────────────
        item_types = tenant.get("item_types") or []
        shop["item_types"] = item_types

        if not item_types and code not in ("finance",):
            rep.query("B", f"{code} · has any item type", "empty list")

        want = EXPECT.get(code, {})
        for t_ in want.get("must", []):
            if t_ not in item_types:
                rep.bug("B", f"{code} · may sell {t_}", f"item_types = {item_types}")
        for t_ in want.get("must_not", []):
            if t_ in item_types:
                rep.bug("B", f"{code} · must NOT offer {t_}", f"item_types = {item_types}")

        # ── units and variant attributes follow the trade ───────────────
        #
        # There is no per-shop endpoint for these, and the first run of this
        # sweep raised a 404 against an invented `/shop/business-type`. The
        # trade's units and variant attributes ride the PUBLIC `/business-types`
        # catalog, and the shop picks its own row out of it — which is right:
        # the list is the same for every tenant of a trade, so a per-tenant
        # endpoint would be the same data behind a login and a cache nobody can
        # share.
        #
        # It matches on `business_type_primary`, and that is load-bearing. The
        # catalog HIDES legacy codes, so a shop still carrying `restaurant` or
        # `clinic` finds no row at all if the raw code is used — no units, no
        # variant attributes, silently. The panel reads the primary
        # (usePrimaryBusinessType), so this sweep must too, or it is testing a
        # different lookup from the one that ships.
        cfg = catalog.get(primary or expected) or {}
        shop["units"] = cfg.get("units") or []
        shop["variant_attributes"] = cfg.get("variant_attributes") or []

        if not cfg:
            rep.bug("B", f"{code} · trade has a catalog row", f"no row for {primary!r}")
        elif not shop["units"]:
            rep.query("B", f"{code} · units offered", "none")
        else:
            rep.ok("B", f"{code} · {len(shop['units'])} units, "
                        f"{len(shop['variant_attributes'])} variant attrs")

        # ── the module map, as the shop sees it ─────────────────────────
        shop["primary"] = primary
        shop["features"] = tenant.get("features") or {}
        on = sorted(k for k, v in shop["features"].items() if v)
        rep.ok("B", f"{code} · modules on", ", ".join(on) or "none")

        shops[code] = shop

    return shops
