"""
Phase P — the day.

A shift is one person's drawer. A DAY is the shop's — every lane, every float,
every note walked to the bank, signed off by one person once. It is the unit the
shop's books are actually kept in, and it is the last thing anybody looks at
before going home.

Four things, and every one of them is somebody's money:

    THE DAY IS THE SUM OF ITS SHIFTS   three lanes counted separately must add
                                       up to one figure. If they do not, the
                                       shop reconciles a number that never
                                       existed.
    NOT WHILE A DRAWER IS OPEN         a shift that has not been counted has no
                                       figure yet. Closing the day over it signs
                                       off a variance nobody measured.
    SIGNED OFF ONCE                    a day that can be closed twice can be
                                       closed to two different numbers.
    NOT BY WHOEVER IS STANDING THERE   closing off the day is the sign-off on
                                       every cashier's variance, including the
                                       closer's own. A cashier who can close the
                                       day can bury their own shortfall.

The banking half is the same argument in the other direction: money that left
the shop for the bank must be recorded against the day it left, or the day's
takings and the day's cash disagree for ever.
"""

from api import Api, Report

FLOAT = 1000.0
LANES_TAKE = [500.0, 750.0]
DEPOSIT = 400.0


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code, state in sold.items():
        if not (state.get("features") or {}).get("pos"):
            continue

        token = state["token"]

        # BANKING FIRST, and outside the branch check below.
        #
        # It closes nothing, it runs on the counter the shop actually trades
        # from, and it is where the real bug lived. Ordering it after a branch
        # this phase might not get meant that when the plan's branch ceiling
        # bit — correctly — the check that found the defect was the one that
        # silently stopped running.
        _banking_lands_on_the_day(api, rep, code, token)

        # THEN THIS PHASE'S OWN BRANCH, and the reason is the whole problem
        # with testing a day close: closing one is IRREVERSIBLE. A day is keyed
        # on branch + date and there is no re-open path, so the first version
        # shut the real trading day on all eight shops and every other phase
        # went red at once — "Trading on 2026-08-19 has already been closed
        # off" — from phase C onward, for the rest of the day.
        #
        # A day belongs to a BRANCH, so the fix is the same one a real shop
        # uses: do it somewhere else. This branch trades nothing anyone else
        # touches, and its day may be closed as often as the sweep likes.
        branch = _its_own_branch(api, rep, code, token)
        if branch is None:
            continue

        at = {"X-Branch-Id": branch}
        day = _the_open_day(api, rep, code, token, at)
        if day is None:
            continue

        _a_cashier_cannot_sign_off_the_day(api, rep, code, state, token, day, at)
        _the_day_will_not_close_over_an_open_drawer(api, rep, code, token, day, at)
        _the_day_is_the_sum_of_its_shifts(api, rep, code, token, day, at)

    return sold


# ── is there a day at all ──────────────────────────────────────────────

def _the_open_day(api: Api, rep: Report, code: str, token: str, at: dict) -> dict | None:
    """
    A shop that is trading has a day open. Nothing asks for one to be started —
    it appears when the first drawer does — so if there is no day after Phase C
    has sold things, the shop's takings belong to nothing.
    """
    status, body = api.get("/pos/day", token=token, headers=at)
    if status != 200:
        rep.bug("P", f"{code} · the shop can read its trading day", str(status))
        return None

    # `/pos/day` answers with the day AND its shifts, its banking and what is
    # still in the drawers — one screen's worth, not one row. The day itself is
    # under `day`, and reading `data` as the day gives an object with no id.
    day = (body.get("data") or {}).get("day")
    if not day:
        # Phase C closes its drawer, and a day with no open shift may legitimately
        # have been closed with it. Open one so this phase has a day to work on.
        api.post("/pos/session/open", {"opening_float": FLOAT}, token=token, headers=at)
        _, body = api.get("/pos/day", token=token, headers=at)
        day = (body.get("data") or {}).get("day")

    if not day:
        rep.bug("P", f"{code} · A TRADING DAY EXISTS",
                "the shop is selling and no day is open — its takings belong to nothing")
        return None

    rep.ok("P", f"{code} · trading day open", str(day.get("trading_date"))[:10])
    return day


# ── who may sign it off ────────────────────────────────────────────────

def _a_cashier_cannot_sign_off_the_day(api: Api, rep: Report, code: str,
                                       state: dict, token: str, day: dict, at: dict) -> None:
    """
    The person whose variance is being signed off must not be the one signing.

    A cashier who can close the day can close it over their own short drawer,
    and the shop's own record then says a manager agreed.
    """
    cashier = _staff(api, token, f"sweep-{code}-dayclose@qa.test", "Sweep Day Cashier",
                     ["sales.manage", "customers.manage"])
    if cashier is None:
        rep.query("P", f"{code} · a cashier to try the day close with",
                  "could not sign one in")
        return

    status, body = api.post(f"/pos/days/{day['id']}/close", {"notes": "Sweep"}, token=cashier, headers=at)
    if status in (200, 201):
        rep.bug("P", f"{code} · THE DAY IS NOT SIGNED OFF BY A CASHIER",
                "a selling preset closed the trading day — it can bury its own shortfall")
    else:
        rep.ok("P", f"{code} · a cashier cannot close the day", str(status))


# ── not while a drawer is open ─────────────────────────────────────────

def _the_day_will_not_close_over_an_open_drawer(api: Api, rep: Report, code: str,
                                                token: str, day: dict, at: dict) -> None:
    """
    An uncounted drawer has no figure. Closing the day over it signs off a
    variance nobody ever measured, and the shop can never go back and measure it
    — the day is shut.
    """
    # `/pos/session` answers 200 with the LAST session whether it is open or
    # shut, so "is there a drawer open" is `status == "open"` and never "did the
    # call return a body". Reading it the lazy way meant this check closed days
    # that had no open drawer at all and then reported the refusal it never got
    # as a product bug, on three shops out of seven.
    _, body = api.get("/pos/session", token=token, headers=at)
    session = body.get("data") or {}
    if session.get("status") != "open":
        opened, body = api.post("/pos/session/open", {"opening_float": FLOAT}, token=token, headers=at)
        if opened not in (200, 201):
            rep.query("P", f"{code} · a drawer to hold the day open", _why(opened, body))
            return

    status, body = api.post(f"/pos/days/{day['id']}/close", {"notes": "Sweep"}, token=token, headers=at)
    error = (body.get("meta") or {}).get("error_code")

    if status in (200, 201):
        rep.bug("P", f"{code} · THE DAY WAITS FOR EVERY DRAWER",
                "the day closed with a shift still open — it signed off a variance nobody counted")
    else:
        rep.ok("P", f"{code} · day refused while a drawer is open",
               f"{status} {error or ''}".strip())


# ── the banking ────────────────────────────────────────────────────────

def _banking_lands_on_the_day(api: Api, rep: Report, code: str, token: str) -> None:
    """
    Money walked to the bank belongs to the day the shop is trading.

    "Which day is open?" is asked in three places and answered three ways.
    `CloseBusinessDayAction::open` keys on branch + TODAY'S DATE, which is what
    a day is. `BusinessDayController::current` — the screen — takes the open day
    with the latest trading date. `storeDeposit` takes an open day with **no
    ordering at all**, so the database hands it whichever it likes, and on a
    counter with an unclosed day behind it that is the OLD one.

    A shop with one open day never sees it. A shop that forgot to close last
    night banks today's takings against yesterday, the banking column on
    today's screen never moves, and yesterday's day closes carrying money that
    was not in it.
    """
    _, body = api.get("/pos/day", token=token)
    today = (body.get("data") or {}).get("day") or {}
    if not today.get("id"):
        rep.query("P", f"{code} · a trading day to bank against", "none open")
        return

    _, body = api.get("/pos/days", token=token)
    open_days = [d for d in _rows(body) if d.get("status") == "open"]
    rep.ok("P", f"{code} · {len(open_days)} day(s) open at the counter",
           "one is the ordinary case; more than one is the shop that forgot to close")

    status, body = api.post("/pos/deposits", {
        "amount": DEPOSIT,
        "bank_name": "Sweep Bank",
        "slip_number": "SWEEP-SLIP-1",
    }, token=token)

    if status not in (200, 201):
        rep.bug("P", f"{code} · bank the day's takings", _why(status, body))
        return

    banked = body.get("data") or {}
    if banked.get("business_day_id") != today["id"]:
        landed = next((d for d in open_days if d.get("id") == banked.get("business_day_id")), {})
        rep.bug("P", f"{code} · A DEPOSIT BELONGS TO THE DAY THE SHOP IS TRADING",
                f"banked on {str(landed.get('trading_date'))[:10] or banked.get('business_day_id')}, "
                f"the counter is trading {str(today.get('trading_date'))[:10]} "
                f"— {len(open_days)} days open, and two endpoints pick different ones")
    else:
        rep.ok("P", f"{code} · deposit landed on the trading day", f"{DEPOSIT:.0f}")

    status, body = api.get("/pos/deposits", token=token)
    slips = [d.get("slip_number") for d in _rows(body)]
    if "SWEEP-SLIP-1" not in slips:
        rep.bug("P", f"{code} · A DEPOSIT IS FINDABLE AGAIN",
                f"SWEEP-SLIP-1 is not among {len(slips)} deposits")
    else:
        rep.ok("P", f"{code} · deposit is on the banking list")


# ── the arithmetic ─────────────────────────────────────────────────────

def _the_day_is_the_sum_of_its_shifts(api: Api, rep: Report, code: str,
                                      token: str, day: dict, at: dict) -> None:
    """
    Close every drawer, close the day, and the day's figures must be the shifts'
    figures added up. This is the only check here that touches the number the
    shop's books are actually kept in.
    """
    _, body = api.get(f"/pos/days/{day['id']}", token=token, headers=at)
    shifts = _sessions(body)

    # Count out whatever is still open, so the day is closable at all.
    for s in shifts:
        if s.get("status") == "open":
            api.post("/pos/session/close", {"counted_cash": s.get("opening_float") or FLOAT},
                     token=token, headers=at)

    status, body = api.post(f"/pos/days/{day['id']}/close", {"notes": "Sweep close"}, token=token, headers=at)
    if status not in (200, 201):
        rep.query("P", f"{code} · close the day", _why(status, body))
        return

    closed = body.get("data") or {}
    rep.ok("P", f"{code} · day closed", f"{closed.get('shifts_count')} shift(s)")

    _, body = api.get(f"/pos/days/{day['id']}", token=token, headers=at)
    shifts = _sessions(body)

    for field in ("opening_float", "cash_sales", "cash_in"):
        want = round(sum(float(s.get(field) or 0) for s in shifts), 2)
        got = round(float(closed.get(field) or 0), 2)
        if abs(want - got) > 0.01:
            rep.bug("P", f"{code} · THE DAY IS THE SUM OF ITS SHIFTS",
                    f"{field}: {len(shifts)} shift(s) total {want}, the day says {got}")
        else:
            rep.ok("P", f"{code} · day's {field} adds up", f"{got}")

    if round(float(closed.get("shifts_count") or 0)) != len(shifts):
        rep.bug("P", f"{code} · THE DAY COUNTS EVERY SHIFT",
                f"{len(shifts)} on the day, it recorded {closed.get('shifts_count')}")
    else:
        rep.ok("P", f"{code} · every shift counted", str(len(shifts)))

    # Signed off ONCE. A day that closes twice can close to two figures, and the
    # second one silently replaces a number somebody has already banked against.
    status, body = api.post(f"/pos/days/{day['id']}/close", {"notes": "again"}, token=token, headers=at)
    error = (body.get("meta") or {}).get("error_code")
    if status in (200, 201):
        rep.bug("P", f"{code} · A DAY IS SIGNED OFF ONCE",
                "the day closed a second time — two sign-offs, two figures")
    else:
        rep.ok("P", f"{code} · second close refused", f"{status} {error or ''}".strip())


# ── helpers ────────────────────────────────────────────────────────────

DAY_BRANCH = "Sweep Day"
MOST_BRANCHES = 12


def _its_own_branch(api: Api, rep: Report, code: str, token: str) -> str | None:
    """
    A branch whose day this phase may still close.

    Closing a day is a ONCE-PER-DAY-PER-BRANCH event and there is no re-open
    path, which makes it the one thing in this whole sweep that cannot simply be
    run again. The first version closed the real trading day on all eight shops
    and every phase from C onward went red for the rest of the day — the shop
    could not open a drawer, which is exactly right and exactly unrecoverable.
    A day belongs to a BRANCH, so this phase trades somewhere nobody else does.
    Once THAT day is shut, it needs the next one.

    A shift open is the honest probe: `/pos/day` answers null both for a branch
    that has never traded and for one whose day is closed, and those are
    opposite answers.
    """
    status, body = api.get("/branches", token=token)
    existing = {b.get("name"): b.get("id") for b in (_rows(body) if status == 200 else [])}

    for n in range(1, MOST_BRANCHES + 1):
        name = f"{DAY_BRANCH} {n}"
        branch = existing.get(name)

        if branch is None:
            status, body = api.post("/branches", {"name": name, "code": f"SWPD{n}"}, token=token)
            if status not in (200, 201):
                rep.query("P", f"{code} · a branch of its own to close the day on",
                          _why(status, body))
                return None
            branch = (body.get("data") or {}).get("id")
            rep.ok("P", f"{code} · day branch opened", name)

        at = {"X-Branch-Id": branch}
        _, body = api.get("/pos/session", token=token, headers=at)
        if (body.get("data") or {}).get("status") == "open":
            return branch

        status, body = api.post("/pos/session/open", {"opening_float": FLOAT},
                                token=token, headers=at)
        if status in (200, 201):
            return branch

        if (body.get("meta") or {}).get("error_code") != "BUSINESS_DAY_CLOSED":
            rep.query("P", f"{code} · open a drawer on {name}", _why(status, body))
            return None
        # This branch has already had its day closed today. Take the next one.

    rep.query("P", f"{code} · a branch whose day is still open",
              f"all {MOST_BRANCHES} sweep day branches are closed off for today")
    return None


def _sessions(body: dict) -> list:
    """`/pos/days/{id}` carries them on the day; `/pos/day` beside it."""
    data = body.get("data") or {}
    rows = data.get("sessions")
    if isinstance(rows, list):
        return rows
    rows = (data.get("day") or {}).get("sessions")
    return rows if isinstance(rows, list) else []


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
