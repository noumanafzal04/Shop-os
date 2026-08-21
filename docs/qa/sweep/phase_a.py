"""
Phase A — the admin side, before any shop exists.

Everything the platform console can do to a tenant, checked from outside: what
it offers at creation, what it enforces afterwards, and what it must refuse.

The order matters. Plans exist before tenants; a tenant exists before its
modules can be moved; limits mean nothing until something tries to exceed them.
"""

import json

from api import Api, Report

ADMIN = "admin@shopos.test"

# The eight PRIMARY codes. The nine legacy ones (restaurant, grocery, clinic,
# salon, workshop, service, wholesale, books, hardware) resolve into these via
# BusinessTypes::primary and are deliberately not swept separately — a sweep of
# an alias is a sweep of its target with a different label.
TYPES = ["food", "mart", "pharmacy", "retail", "services", "automotive", "finance", "petroleum"]


def run(api: Api, rep: Report) -> dict:
    """Returns {type_code: {tenant_id, owner_email}} for the later phases."""

    token = api.login(ADMIN)
    if token is None:
        # The server's own answer, never a guess about the seeder. This line
        # said "is the seeder run?" about an account that logs in fine, and the
        # real reason was thrown away with it.
        rep.bug("A", "admin can log in", f"{ADMIN} refused · {api.why_login_failed()}")
        return {}
    api.token = token
    rep.ok("A", "admin can log in")

    # ── A0 · what the console offers ────────────────────────────────────
    #
    # A LIST of {code, label, features, …}, not a map. Worth stating: the first
    # version of this sweep assumed a map keyed by code, found nothing, and
    # reported all eight types missing — a harness bug that looked exactly like
    # a product bug. An audit that produces findings is a thing to verify.
    status, body = api.get("/business-types")
    rep.expect("A", "business types are listed", status, 200)
    types = {t["code"]: t for t in (body.get("data") or []) if isinstance(t, dict)}

    if types:
        rep.ok("A", f"{len(types)} type codes offered")
        missing = [t for t in TYPES if t not in types]
        if missing:
            rep.bug("A", "every primary type is offered", f"missing: {missing}")

    # ── A1 · plans ──────────────────────────────────────────────────────
    status, body = api.get("/admin/plans")
    rep.expect("A", "plans list", status, 200)
    raw = body.get("data") or []
    plans = raw if isinstance(raw, list) else raw.get("data", [])

    if not plans:
        rep.bug("A", "at least one plan exists", "no plan means no tenant can be created")
        return {}

    # PKR only, everywhere. A rendered dollar sign is a bug on its own.
    for p in plans:
        if "$" in json.dumps(p):
            rep.bug("A", "a plan renders a dollar sign", str(p.get("name")))

    plan_id = plans[0]["id"]
    rep.ok("A", f"using plan · {plans[0].get('name')}")

    # ── A2 · a tenant per business type ─────────────────────────────────
    made: dict[str, dict] = {}
    for code in TYPES:
        email = f"sweep-{code}@qa.test"
        payload = {
            "business_name": f"Sweep {code.title()}",
            "email": f"shop-{code}@qa.test",
            "business_type": code,
            "plan_id": plan_id,
            "owner": {"name": f"{code.title()} Owner", "email": email, "password": "password"},
        }
        status, body = api.post("/admin/tenants", payload)

        # A sweep has to be RE-RUNNABLE. The first version reported eight bugs
        # on its second run — "a business with this name already exists" — which
        # is the console working correctly and the harness assuming a fresh
        # database. A sweep that can only run once is a sweep nobody runs.
        if status == 422 and _already_exists(body):
            found = _find_tenant(api, code)
            if found is None:
                rep.bug("A", f"reuse tenant · {code}", "exists but could not be found")
                continue
            made[code] = {"id": found.get("id"), "email": email, "primary": code,
                          "features": found.get("features") or {}}
            rep.ok("A", f"reuse tenant · {code}")
            continue

        if status not in (200, 201):
            errs = body.get("errors") or body.get("message")
            rep.bug("A", f"create tenant · {code}", f"{status} {errs}")
            continue

        data = body.get("data") or {}
        made[code] = {"id": data.get("id"), "email": email, "primary": code,
                      "features": data.get("features") or {}}
        rep.ok("A", f"create tenant · {code}")

        # The module map it was born with must match what the type PROPOSES.
        # A type proposes; the admin assigns. If a proposal silently fails to
        # arrive, every shop of that trade opens missing a module it was
        # promised, and nobody would know where to look.
        proposed = (types.get(code) or {}).get("features") or {}
        for module, on in proposed.items():
            got = (data.get("features") or {}).get(module)
            if on and got is not True:
                rep.query("A", f"{code} · proposed module not granted", f"{module} = {got!r}")

    restaurant = _category_is_not_only_a_label(api, rep, plan_id)
    if restaurant is not None:
        made["food_restaurant"] = restaurant

    # AFTER the restaurant exists, or it is the one shop left on the default
    # ceiling — which it was, and it failed to hire half its own presets while
    # every other shop sailed through. Ordering, not permissions.
    _limits_bite_then_move(api, rep, made)

    return made


# What the sweep needs room for: several jobs at once, three lanes, and a second
# branch to move stock to. The DEFAULTS are deliberately smaller than that.
# Branches: Main, phase K's second, and one per phase-P run TODAY. Closing a
# trading day is irreversible and keyed on branch + date, so a second run on the
# same afternoon needs a branch whose day is still open. Ten is a fortnight of
# re-runs before the ceiling — which is itself proved to refuse, above, before
# any of this is raised.
#
# Thirty, not twelve: a day of active development runs this sweep far more often
# than a fortnight of ordinary use, and when the branches ran out phase P's day
# close stopped running and the mutation aimed at it came back UNCLEAR. They
# cost nothing and free themselves at midnight.
ROOM = {"staff": 30, "registers": 6, "branches": 30}


def _limits_bite_then_move(api: Api, rep: Report, made: dict) -> None:
    """
    Prove the ceiling is real before raising it.

    A shop is capped at 5 staff, 2 registers and 1 branch until somebody
    decides otherwise, and the later phases need more than that. The wrong
    response would be to quietly raise everything and get on with it — a limit
    that is never observed refusing anything is indistinguishable from a limit
    that does not work, and this is the only place in the sweep that can tell
    the difference.

    So: watch it refuse, raise it, watch it allow. Then the phases that follow
    are standing on a checked foundation rather than a convenient one.
    """
    victim = made.get("mart") or next(iter(made.values()), None)
    if victim is None:
        return

    status, body = api.get(f"/admin/tenants/{victim['id']}")
    limits = ((body.get("data") or {}).get("limits") or {}) if status == 200 else {}

    # Reported either way. A check that silently skips itself when a field is
    # missing is a check that quietly stops running — the exact failure this
    # sweep has already had to fix in its own mutation harness.
    if limits:
        rep.ok("A", "limits are reported per tenant",
               ", ".join(f"{k}={_ceiling(v)}" for k, v in sorted(limits.items())[:4]))
    else:
        rep.query("A", "the admin can see a tenant's limits",
                  f"no `limits` on the tenant detail; keys: "
                  f"{sorted((body.get('data') or {}).keys())[:12]}")

    owner = api.login(victim["email"])
    if owner is None:
        rep.query("A", "limits · owner sign-in to test the ceiling", victim["email"])
    else:
        _, body = api.get("/registers", token=owner)
        have = len(_list(body))

        # 1 · a ceiling cannot be set BELOW what the shop already uses.
        #     A limit that strands existing rows in an illegal state is not a
        #     limit, it is a trap — the shop would be over its allowance with no
        #     action available that brings it back under.
        status, body = api.put(f"/admin/tenants/{victim['id']}/limits",
                               {"limits": {"registers": max(have - 1, 0)}})
        code_ = (body.get("meta") or {}).get("error_code")
        if status in (200, 201):
            rep.bug("A", "A CEILING CANNOT BE SET BELOW CURRENT USAGE",
                    f"the shop has {have} registers and the limit was set to {max(have - 1, 0)}")
        else:
            rep.ok("A", "a ceiling below current usage is refused", code_ or str(status))

        # 2 · at exactly current usage, the next one is refused.
        status, _ = api.put(f"/admin/tenants/{victim['id']}/limits", {"limits": {"registers": have}})
        if status not in (200, 201):
            rep.query("A", "limits · pin the ceiling to current usage", str(status))
        else:
            status, body = api.post("/registers", {"name": "One too many"}, token=owner)
            if status in (200, 201):
                rep.bug("A", "A REGISTER LIMIT ACTUALLY REFUSES",
                        f"a lane beyond the ceiling of {have} was created")
                api.delete(f"/registers/{(body.get('data') or {}).get('id')}", token=owner)
            else:
                rep.ok("A", "the register ceiling refuses", str(status))

    # 3 · raise everything the sweep needs, on every tenant it made.
    for code, t in made.items():
        status, _ = api.put(f"/admin/tenants/{t['id']}/limits", {"limits": ROOM})
        if status not in (200, 201):
            rep.bug("A", f"{code} · raise the limits", str(status))

    # 4 · and now it allows.
    if owner is not None:
        status, body = api.post("/registers", {"name": "Room to work"}, token=owner)
        if status in (200, 201):
            rep.ok("A", "raising the ceiling lets the next one through")
            api.delete(f"/registers/{(body.get('data') or {}).get('id')}", token=owner)
        else:
            rep.bug("A", "RAISING A CEILING TAKES EFFECT AT ONCE", str(status))


def _ceiling(v) -> str:
    if isinstance(v, dict):
        v = v.get("limit", v.get("max"))
    return "∞" if v is None else str(v)


def _list(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])


def _category_is_not_only_a_label(api: Api, rep: Report, plan_id: str) -> dict | None:
    """
    Does the sub-type do anything, or is it just a word on a form?

    `business_category` is free text (max:100, no enum) and 16 of its 17 uses
    are display or search. Exactly ONE is behavioural: a food tenant whose
    category is a restaurant, cafe, bakery, fast-food or cloud kitchen gets the
    INVENTORY module, because those keep a store room and a juice corner does
    not.

    That single rule is worth a check of its own precisely because it is the
    only one. A category that silently stopped switching inventory on would
    leave every restaurant unable to track a single ingredient — and the screen
    that sets it would still look like it worked.

    The rule only ever turns inventory ON. A sub-type must never take away what
    the parent type grants, or the two argue and the type loses.
    """
    plain = _find_tenant(api, "food")
    if plain is None:
        rep.query("A", "category · plain food tenant to compare against", "not found")
        return None

    name = "Sweep Food Restaurant"
    email = "sweep-food-restaurant@qa.test"
    status, body = api.post("/admin/tenants", {
        "business_name": name,
        "email": "shop-food-restaurant@qa.test",
        "business_type": "food",
        "business_category": "restaurant",
        "plan_id": plan_id,
        "owner": {"name": "Restaurant Owner", "email": email, "password": "password"},
    })

    if status == 422 and _already_exists(body):
        found = _find_tenant(api, "food", name)
        data = found or {}
    elif status in (200, 201):
        data = body.get("data") or {}
    else:
        rep.bug("A", "category · create a food tenant with one", f"{status} {body.get('errors')}")
        return None

    with_cat = (data.get("features") or {}).get("inventory")
    without = (plain.get("features") or {}).get("inventory")

    if with_cat is True and without is not True:
        rep.ok("A", "category · restaurant turns inventory on", "food alone does not")
    elif with_cat is not True:
        rep.bug("A", "CATEGORY IS ONLY A LABEL",
                f"food+restaurant got inventory={with_cat!r} — a restaurant cannot track an ingredient")
    else:
        rep.query("A", "category · food already had inventory",
                  "the sub-type rule cannot be observed from outside")

    # Handed back so the later phases can use it. It is the only shop in the
    # sweep that is a RESTAURANT — a kitchen with a store room — which is what a
    # recipe needs to deplete anything.
    # `food_restaurant` is the SWEEP's label for this shop, not a business type.
    # Its trade is food; the category only decided which modules it was born
    # with. Saying so here keeps the later phases from comparing a label against
    # a type and reporting the difference as a finding.
    return {"id": data.get("id"), "email": email, "primary": "food",
            "features": data.get("features") or {}}


def _already_exists(body: dict) -> bool:
    """Is this 422 the console refusing a duplicate, rather than a real fault?"""
    errs = body.get("errors") or {}
    return any("already exists" in m for msgs in errs.values() for m in msgs)


def _find_tenant(api: Api, code: str, name: str | None = None) -> dict | None:
    """The tenant this sweep made last time, by the name it always uses."""
    want = name or f"Sweep {code.title()}"
    status, body = api.get(f"/admin/tenants?search={want.replace(' ', '+')}")
    if status != 200:
        return None
    raw = body.get("data") or []
    rows = raw if isinstance(raw, list) else raw.get("data", [])
    return next((r for r in rows if r.get("business_name") == want), None)
