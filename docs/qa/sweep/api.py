"""
The smallest HTTP client that can drive ShopOS, plus the sweep's own reporting.

Deliberately not a test framework. A sweep REPORTS what it saw — a surprising
answer is something to look at, not a red build — because half of what it finds
turns out to be correct behaviour nobody had written down.

Every call records its request and response, so a finding can be reproduced by
copying one line rather than by remembering what was clicked.
"""

import json
import pathlib
import time
import urllib.error
import urllib.request

BASE = "http://localhost:8000/api/v1"

# Tokens survive between runs, and that is the point.
#
# `throttle:auth` is 5 logins per minute PER IP, and this sweep drives nine
# identities — one admin and eight shop owners. The first version logged them
# all in back to back and reported six failures as bugs; the limit was doing
# exactly its job. The fix is not a looser limit. It is a sweep that logs in
# once, keeps what it was given, and only asks again when the token stops
# working — which is also how the panel behaves, so the sweep now exercises the
# same path a real client takes.
TOKENS = pathlib.Path(__file__).with_name(".tokens.json")

# Explicitly nobody. See the note in `call`.
NOBODY = object()


class Api:
    def __init__(self, base: str = BASE) -> None:
        self.base = base
        self.token: str | None = None
        self.calls: list[dict] = []
        self.headers: dict = {}
        # What the server actually said the last time a sign-in failed. A phase
        # reporting "refused — is the seeder run?" with no status hid the real
        # answer behind a guess about the seeder, and cost a run to find out.
        self.last_login_error: tuple[int, str] | None = None
        # ── THE HARNESS CANNOT ASK, SO IT MAY NOT ANSWER ────────────────
        #
        # `call()` already knows the difference between "the server refused"
        # and "we never got to ask", and says so in a status no route returns.
        # It then handed that 0 back to a phase which read the empty body and
        # filed a PRODUCT BUG — 325 `rep.bug` calls across 21 phases and not
        # one of them looks at the status first.
        #
        # Seen for real: a throttled sign-in (`throttle:auth` is 5/min and this
        # sweep drives ~100 identities) produced
        #     BUG A  at least one plan exists — no plan means no tenant can be created
        # against a database holding four active plans. The whole run stopped on
        # a defect that did not exist.
        #
        # So the Api carries whether it is currently BLIND. Set the moment a
        # call cannot be made, cleared by the next call that gets a real HTTP
        # status back. `Report.bug` refuses to file while it is set.
        self.blind: str | None = None
        self._cache: dict = {}
        if TOKENS.exists():
            try:
                self._cache = json.loads(TOKENS.read_text())
            except json.JSONDecodeError:
                self._cache = {}

    def call(self, method: str, path: str, body: dict | None = None,
             token: str | None = None, _retry: bool = False,
             headers: dict | None = None) -> tuple[int, dict]:
        url = f"{self.base}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        # `token=NOBODY` means "send no credentials", which is NOT the same as
        # `token=None` ("use whatever is current"). A permission probe that
        # falls back to the ambient token when a staff sign-in failed runs as
        # the WRONG PERSON and reports 401 as though it were 403 — a refusal
        # that proves nothing, printed as a pass. That happened, and it is the
        # most dangerous kind of harness bug there is.
        use = None if token is NOBODY else (token if token is not None else self.token)

        # ── A request with NO credentials at all is a harness fault ──────
        #
        # The sibling of the bug the note above describes, and it cost a whole
        # run. `login()` returns None when a sign-in could not be had — a cold
        # token cache plus `throttle:auth` at 5/min per IP, and a full sweep
        # drives about a hundred identities. The phase then called on with
        # `token=None`, which falls through to an ambient token that was also
        # None, so the request went out bare and the server said 401.
        #
        # Every one of those 401s was then reported as a PRODUCT BUG: one run
        # printed 96 of them, including "the shop has a Main branch — 0
        # branches" about a shop that has eighteen. The server was answering
        # correctly and the sweep was asking as nobody.
        #
        # `NOBODY` stays the way to ask anonymously ON PURPOSE. Arriving here
        # with nothing by accident is a different thing and now says so, in a
        # status no route ever returns, so a caller cannot mistake it for a
        # refusal.
        if use is None and token is not NOBODY:
            self.calls.append({"method": method, "path": path, "status": 0,
                               "error": "no credentials"})
            self.blind = f"no token for {method} {path} — the sign-in failed"
            return 0, {
                "message": "HARNESS: no token — the sign-in failed and this "
                           "call was about to run as nobody",
                "meta": {"error_code": "HARNESS_NO_TOKEN"},
            }

        if use:
            req.add_header("Authorization", f"Bearer {use}")
        # A till identifies its LANE and its DEVICE by header, not by body —
        # the POS rate limit is keyed on the device id, so a sweep that cannot
        # send one is not driving the counter the way the counter drives.
        for name, value in (headers or {}).items():
            req.add_header(name, value)

        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                status, raw, self.headers = r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            status, raw, self.headers = e.code, e.read(), dict(e.headers)
        except Exception as e:  # connection refused, timeout
            self.calls.append({"method": method, "path": path, "status": 0, "error": str(e)})
            self.blind = f"{method} {path} never reached the server — {e}"
            return 0, {"message": str(e)}

        # THE SERVER ANSWERED, so the harness can see again — including a 4xx,
        # which is an answer ABOUT THE PRODUCT and one many checks are asserting
        # on. Only reaching this line lifts it; the two sentinel returns above
        # never do.
        self.blind = None

        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            # Not JSON — a CSV export, an HTML error page, a receipt.
            #
            # `raw` is a 400-character PREVIEW, for putting in a finding without
            # printing a megabyte. It is not the response. A check that read it
            # as one saw the header line of a catalog export and reported that
            # every shop had exported zero products.
            text = raw.decode(errors="ignore")
            payload = {"raw": text[:400], "text": text}

        self.calls.append({"method": method, "path": path, "status": status})

        # ── 429 is the server pacing us, and it is right ────────────────
        #
        # The general limit is 240/min per user. One pass of this sweep does not
        # come close; five back to back do, and the fourth one died mid-phase
        # with "Too many requests" — which the mutation harness then reported as
        # "THE CHECK IS BLIND". It was not blind. It never ran.
        #
        # So: wait it out here, once, using the server's own figure. A sweep
        # that trips a rate limit and calls the result a finding is a sweep that
        # manufactures bugs, and this one nearly did.
        # ── 401 means MY CREDENTIAL DIED, not that the shop refused ─────
        #
        # An access token carries `expires_at` = minted + ONE HOUR, set per
        # token rather than through config/sanctum.php — which is why reading
        # `'expiration' => null` there proves nothing. A full sweep takes longer
        # than an hour, so tokens minted in phase A are dead by the later
        # phases, and every call after that point came back 401.
        #
        # One run printed **97 BUGS** that were all this: "hire a buyer — 401",
        # "add Lane 1 — 401", "the shop is offered job presets — 401". The
        # server was answering correctly about a credential that had expired
        # mid-run, and the sweep was reporting it as a product defect.
        #
        # Same rule as HARNESS_NO_TOKEN above, one step further along: a tool
        # that cannot do its job must SAY SO rather than answer anyway. So the
        # identity is signed in again and the call retried once — and if that
        # fails, the answer is a harness status no route ever returns, never a
        # 401 a phase could read as a refusal.
        if status == 401 and use is not None and token is not NOBODY and not _retry:
            email = next((e for e, t in self._cache.items() if t == use), None)
            if email is not None:
                print(f"       … token expired for {email}, signing in again", flush=True)
                self._cache.pop(email, None)
                fresh = self.login(email)
                if fresh:
                    return self.call(method, path, body, fresh, _retry=True, headers=headers)

            self.calls.append({"method": method, "path": path, "status": 0,
                               "error": "credential expired"})
            self.blind = f"token expired during {method} {path} and would not renew"
            return 0, {
                "message": "HARNESS: the token expired mid-run and could not be "
                           "renewed — this is not an answer about the product",
                "meta": {"error_code": "HARNESS_TOKEN_EXPIRED"},
            }

        if status == 429 and not _retry:
            wait = min(int(self.headers.get("Retry-After") or 61) + 1, 70)
            print(f"       … rate limited on {path}, waiting {wait}s", flush=True)
            time.sleep(wait)
            return self.call(method, path, body, token, _retry=True, headers=headers)

        return status, payload

    def get(self, p, **kw): return self.call("GET", p, **kw)
    def post(self, p, b=None, **kw): return self.call("POST", p, b or {}, **kw)
    def put(self, p, b=None, **kw): return self.call("PUT", p, b or {}, **kw)
    def patch(self, p, b=None, **kw): return self.call("PATCH", p, b or {}, **kw)
    def delete(self, p, **kw): return self.call("DELETE", p, **kw)

    def login(self, email: str, password: str = "password") -> str | None:
        """A token for this identity, asking the server only when it must."""
        cached = self._cache.get(email)
        if cached and self._alive(cached):
            return cached

        token = self._login_fresh(email, password)
        if token:
            self._cache[email] = token
            TOKENS.write_text(json.dumps(self._cache, indent=2))
        return token

    def why_login_failed(self) -> str:
        """The server's own words, for a phase that has to report a refusal."""
        if self.last_login_error is None:
            return "no answer recorded"
        status, message = self.last_login_error

        return f"{status} {message}"

    def _alive(self, token: str) -> bool:
        """Cheap and honest: the token works if the server answers as somebody."""
        status, _ = self.get("/auth/me", token=token)
        return status == 200

    def _login_fresh(self, email: str, password: str) -> str | None:
        # `identifier`, not `email`: the field takes an email OR a phone, and
        # naming it `email` would be a lie the day a shopkeeper types their
        # number. Worth knowing before writing a client.
        # Ten, not four. `throttle:auth` is 5/min per IP and this sweep drives
        # about a hundred identities, so a cold cache needs minutes of pure
        # waiting. Giving up early returns None, and a None token used to send
        # the call anyway — bare, as nobody, collecting a 401 that got printed
        # as a product bug. A slow run beats a wrong one.
        for _ in range(10):
            # `NOBODY`, explicitly. A sign-in is the one call that is SUPPOSED
            # to carry no credentials, and the guard in `call()` — which refuses
            # to run a check as nobody — would otherwise block the very request
            # that fetches the token. It did, on its first run.
            status, body = self.post("/auth/login",
                                     {"identifier": email, "password": password},
                                     token=NOBODY)

            if status == 200:
                self.last_login_error = None

                return (body.get("data") or {}).get("access_token")

            self.last_login_error = (status, str(body.get("message") or body)[:120])

            # 429 is the brute-force guard, and it is CORRECT. Wait it out
            # rather than reporting it, and take the server's own figure —
            # a hard-coded sleep is a guess that goes stale the day the limit
            # changes.
            if status != 429:
                return None

            wait = int(self.headers.get("Retry-After") or 61)
            print(f"       … throttled, waiting {wait}s for {email}", flush=True)
            time.sleep(min(wait + 1, 70))

        return None


class Report:
    """
    What the sweep saw.

    Three levels, and the middle one is the reason this is not a test suite:

      PASS   the thing happened, as expected
      QUERY  the thing happened differently — LOOK AT IT. Half of these are
             correct behaviour that was never written down, and finding those is
             worth as much as finding a bug.
      BUG    a definite defect, reproducible from the recorded call
    """

    def __init__(self, api: "Api | None" = None, quiet: bool = False) -> None:
        self.rows: list[tuple[str, str, str, str]] = []
        # The preflight in `harness_test` files a deliberate bug to prove real
        # ones still get through. Printed, it lands in the run's console above
        # phase A looking exactly like a finding — which is the confusion this
        # whole change exists to remove.
        self.quiet = quiet
        # The Api, so a verdict can be refused when it was never earned. See
        # `_add`. Optional because `mutate.py` builds a Report on its own.
        self.api = api
        self.blinded = 0

    def _add(self, level, phase, what, detail=""):
        # ── A FINDING NEEDS AN ANSWER BEHIND IT ─────────────────────────
        #
        # `Api.call` distinguishes "the server refused" from "we never got to
        # ask" and returns a status no route uses for the second. Every phase
        # then read the empty body as if it were the product speaking: 325
        # `rep.bug` calls, none of which look at the status first.
        #
        # A throttled sign-in produced, against a database holding four active
        # plans:
        #     BUG A  at least one plan exists — no plan means no tenant can be
        #            created
        # and the run stopped there. The harness had already written "this is
        # not an answer about the product" into the very envelope the phase was
        # reading.
        #
        # Downgraded rather than dropped, and counted: a blinded check is not a
        # passing one, and a run that quietly discarded them would report a
        # clean sweep it never ran. QUERY is exactly the level for "look at
        # this, it may be nothing".
        if level == "BUG" and self.api is not None and self.api.blind:
            self.blinded += 1
            level = "QUERY"
            detail = (f"HARNESS: not asked — {self.api.blind}. "
                      f"This is not an answer about the product. (was: {detail or what})")

        self.rows.append((level, phase, what, detail))
        if self.quiet:
            return
        mark = {"PASS": "  ok  ", "QUERY": " QUERY", "BUG": " BUG  "}[level]
        print(f"{mark} {phase:10} {what}" + (f"  — {detail}" if detail else ""), flush=True)


    def ok(self, phase, what, detail=""): self._add("PASS", phase, what, detail)
    def query(self, phase, what, detail=""): self._add("QUERY", phase, what, detail)
    def bug(self, phase, what, detail=""): self._add("BUG", phase, what, detail)

    def expect(self, phase, what, got, want, detail=""):
        """
        `want` may be a value, or a collection of ACCEPTABLE values.

        That second reading is the footgun, and two phases have now walked into
        it. A list of expected ROWS reads as "any one of these will do", so a
        check comparing an order — `["OLD", "MID"]` — asked whether the whole
        list equalled one of its own members, and reported the exactly-right
        answer as something to look at. An empty list is the same mistake with
        the volume up: nothing can ever be in it, so the check can only ever
        query.

        Two rules, both about the CALLER rather than the product:

          · an empty `want` is always a caller bug — it is unsatisfiable, and a
            check that cannot pass is not a check;
          · when BOTH sides are collections, the caller means EQUALITY. "Is
            this list one of the acceptable values" would need `want` to be a
            list OF lists, which nothing here does.
        """
        if isinstance(want, (set, list, tuple)) and len(want) == 0:
            self.query(phase, what, "HARNESS: expect() was given an empty `want`, "
                                    "which nothing can satisfy — the check cannot pass")
            return False

        both_collections = (isinstance(want, (set, list, tuple))
                            and isinstance(got, (set, list, tuple)))

        if both_collections:
            if list(got) == list(want):
                self.ok(phase, what)
                return True
            self.query(phase, what, detail or f"got {list(got)}, expected {list(want)}")
            return False

        acceptable = want if isinstance(want, (set, list, tuple)) else {want}
        if got in acceptable:
            self.ok(phase, what)
            return True
        self.query(phase, what, detail or f"got {got}, expected {'/'.join(map(str, acceptable))}")
        return False

    def coverage(self, shops: set[str] | None = None) -> dict[str, set[str]]:
        """Which shops each phase actually spoke about.

        `shops` is the list of shops that exist. Without it the parse guesses,
        and a guess in a coverage table is worse than no table — phase A's rows
        are shaped the other way round ("reuse tenant · food"), so the first
        version confidently reported that phase A had covered a shop called
        "category". A denominator you cannot trust is not a denominator.
        """
        seen: dict[str, set[str]] = {}
        for _, phase, what, _d in self.rows:
            # Every check names its shop first: "retail · sale took 3 off".
            # Reading the shop back out of the rows rather than asking each
            # phase to declare it means a phase CANNOT forget to declare.
            code = what.split(" · ")[0] if " · " in what else None
            if code and (code in shops if shops is not None else " " not in code):
                seen.setdefault(phase, set()).add(code)
        return seen

    def summary(self, expect: dict[str, set[str]] | None = None,
                shops: set[str] | None = None) -> int:
        n = {"PASS": 0, "QUERY": 0, "BUG": 0}
        for level, *_ in self.rows:
            n[level] += 1
        if self.quiet:
            return n["BUG"] + self.blinded
        print(f"\n{'='*70}\n{n['PASS']} ok · {n['QUERY']} to look at · {n['BUG']} bugs\n{'='*70}")

        # CHECKS THAT WERE NEVER ASKED, said out loud.
        #
        # Same reasoning as the coverage block below: a run where the token
        # expired halfway would otherwise print a smaller, calmer set of numbers
        # than one that actually ran, and read as the better result. It is the
        # worse one — most of it did not happen.
        if self.blinded:
            print(f"\n!! {self.blinded} check(s) could not be asked at all — the harness was "
                  f"blind (no token, expired token, or the server unreachable).\n"
                  f"   They are listed as QUERY below, NOT as passes and NOT as bugs.\n"
                  f"   Fix the harness and re-run: this result is incomplete.")

        # ── the denominator ────────────────────────────────────────────
        #
        # A count of findings is not evidence without a count of attempts. Phase
        # M could not build a sellable line for a services shop, gave up, and
        # for the whole life of this sweep NOBODY EVER CHECKED a salon's points
        # or coupons — the run still printed a clean green summary, because the
        # checks that did not happen do not appear in a list of checks that did.
        #
        # So the run now says which shops each phase actually spoke about. A
        # phase that quietly covers three trades instead of seven is visible on
        # the last screen of the run rather than in nobody's head.
        seen = self.coverage(shops)
        if seen:
            print("\ncoverage — shops each phase actually spoke about")
            for phase in sorted(seen):
                shops = sorted(seen[phase])
                line = f"  {phase:3} {len(shops):2}  {', '.join(shops)}"
                missing = sorted((expect or {}).get(phase, set()) - seen[phase])
                print(line + (f"   ·  SILENT ON: {', '.join(missing)}" if missing else ""))
            print()

        for level, phase, what, detail in self.rows:
            if level != "PASS":
                print(f"{level:6} {phase:10} {what}" + (f"  — {detail}" if detail else ""))

        # An incomplete run is not a passing run. Returning only the bug count
        # would let a sweep that asked nothing exit 0 — the exact shape of "2225
        # passed" beside a non-zero exit, with the sign flipped.
        return n["BUG"] + self.blinded
# ── WHAT THIS SHOP WAS ACTUALLY GIVEN ────────────────────────────────────
#
# Modules stopped being on-by-default. A restaurant is not given `stocktake`,
# a pharmacy is not given `documents`, and only two trades are given
# `promotions` — that is the product working, and the shop being refused is
# the whole point of the change.
#
# This sweep was written before it, so it asked every trade for everything and
# then reported 23 CORRECT REFUSALS as bugs. A sweep that cries wolf 23 times
# is worse than no sweep: the next real one is read as more noise.
#
# The fix is not to skip. Skipping would leave the fence untested — and the
# fence is exactly what a shop owner asks about ("a module I turned off had
# better not show anywhere"). So a shop WITHOUT the module gets the check it
# deserves: it must be REFUSED, with 403, and not quietly succeed.

def has_module(state: dict, key: str) -> bool:
    """Does this shop have the module? Reads what phase B recorded off the tenant."""
    return bool((state.get("features") or {}).get(key))


def gated_on(rep, phase: str, code: str, state: dict, module: str, label: str, call) -> bool:
    """
    Returns True when the shop HAS the module and the caller should carry on.

    When it does not, the refusal itself is the check: `call()` is made and its
    status must be 403. A 200 here is a module leak — the loudest kind of bug
    this sweep can find — and a 500 is a fence that throws instead of refusing.
    """
    if has_module(state, module):
        return True

    status, _ = call()

    if status == 403:
        rep.ok(phase, f"{code} · {label} refused without `{module}`", "403")
    elif status == 200:
        rep.bug(phase, f"{code} · MODULE LEAK — {label} without `{module}`",
                "the shop was not given this module and the server served it anyway")
    else:
        rep.bug(phase, f"{code} · {label} gated on `{module}` but not with a refusal",
                f"expected 403, got {status}")

    return False

