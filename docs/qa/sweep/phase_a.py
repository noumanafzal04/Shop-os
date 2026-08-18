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
        rep.bug("A", "admin can log in", f"{ADMIN} refused — is the seeder run?")
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
            made[code] = {"id": found.get("id"), "email": email,
                          "features": found.get("features") or {}}
            rep.ok("A", f"reuse tenant · {code}")
            continue

        if status not in (200, 201):
            errs = body.get("errors") or body.get("message")
            rep.bug("A", f"create tenant · {code}", f"{status} {errs}")
            continue

        data = body.get("data") or {}
        made[code] = {"id": data.get("id"), "email": email, "features": data.get("features") or {}}
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

    return made


def _already_exists(body: dict) -> bool:
    """Is this 422 the console refusing a duplicate, rather than a real fault?"""
    errs = body.get("errors") or {}
    return any("already exists" in m for msgs in errs.values() for m in msgs)


def _find_tenant(api: Api, code: str) -> dict | None:
    """The tenant this sweep made last time, by the name it always uses."""
    status, body = api.get(f"/admin/tenants?search=Sweep+{code.title()}")
    if status != 200:
        return None
    raw = body.get("data") or []
    rows = raw if isinstance(raw, list) else raw.get("data", [])
    want = f"Sweep {code.title()}"
    return next((r for r in rows if r.get("business_name") == want), None)
