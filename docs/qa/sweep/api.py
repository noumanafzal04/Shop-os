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
            return 0, {"message": str(e)}

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

    def _alive(self, token: str) -> bool:
        """Cheap and honest: the token works if the server answers as somebody."""
        status, _ = self.get("/auth/me", token=token)
        return status == 200

    def _login_fresh(self, email: str, password: str) -> str | None:
        # `identifier`, not `email`: the field takes an email OR a phone, and
        # naming it `email` would be a lie the day a shopkeeper types their
        # number. Worth knowing before writing a client.
        for _ in range(4):
            status, body = self.post("/auth/login", {"identifier": email, "password": password})

            if status == 200:
                return (body.get("data") or {}).get("access_token")

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

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str, str]] = []

    def _add(self, level, phase, what, detail=""):
        self.rows.append((level, phase, what, detail))
        mark = {"PASS": "  ok  ", "QUERY": " QUERY", "BUG": " BUG  "}[level]
        print(f"{mark} {phase:10} {what}" + (f"  — {detail}" if detail else ""), flush=True)

    def ok(self, phase, what, detail=""): self._add("PASS", phase, what, detail)
    def query(self, phase, what, detail=""): self._add("QUERY", phase, what, detail)
    def bug(self, phase, what, detail=""): self._add("BUG", phase, what, detail)

    def expect(self, phase, what, got, want, detail=""):
        """`want` may be a value or a set of acceptable values."""
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
        print(f"\n{'='*70}\n{n['PASS']} ok · {n['QUERY']} to look at · {n['BUG']} bugs\n{'='*70}")

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
        return n["BUG"]
