"""
The smallest HTTP client that can drive ShopOS, plus the sweep's own reporting.

Deliberately not a test framework. A sweep REPORTS what it saw — a surprising
answer is something to look at, not a red build — because half of what it finds
turns out to be correct behaviour nobody had written down.

Every call records its request and response, so a finding can be reproduced by
copying one line rather than by remembering what was clicked.
"""

import json
import urllib.error
import urllib.request

BASE = "http://localhost:8000/api/v1"


class Api:
    def __init__(self, base: str = BASE) -> None:
        self.base = base
        self.token: str | None = None
        self.calls: list[dict] = []

    def call(self, method: str, path: str, body: dict | None = None,
             token: str | None = None) -> tuple[int, dict]:
        url = f"{self.base}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        use = token if token is not None else self.token
        if use:
            req.add_header("Authorization", f"Bearer {use}")

        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        except Exception as e:  # connection refused, timeout
            self.calls.append({"method": method, "path": path, "status": 0, "error": str(e)})
            return 0, {"message": str(e)}

        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = {"raw": raw[:400].decode(errors="ignore")}

        self.calls.append({"method": method, "path": path, "status": status})
        return status, payload

    def get(self, p, **kw): return self.call("GET", p, **kw)
    def post(self, p, b=None, **kw): return self.call("POST", p, b or {}, **kw)
    def put(self, p, b=None, **kw): return self.call("PUT", p, b or {}, **kw)
    def patch(self, p, b=None, **kw): return self.call("PATCH", p, b or {}, **kw)
    def delete(self, p, **kw): return self.call("DELETE", p, **kw)

    def login(self, email: str, password: str = "password") -> str | None:
        # `identifier`, not `email`: the field takes an email OR a phone, and
        # naming it `email` would be a lie the day a shopkeeper types their
        # number. Worth knowing before writing a client.
        status, body = self.post("/auth/login", {"identifier": email, "password": password})
        if status != 200:
            return None
        return (body.get("data") or {}).get("access_token")


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

    def summary(self) -> int:
        n = {"PASS": 0, "QUERY": 0, "BUG": 0}
        for level, *_ in self.rows:
            n[level] += 1
        print(f"\n{'='*70}\n{n['PASS']} ok · {n['QUERY']} to look at · {n['BUG']} bugs\n{'='*70}")
        for level, phase, what, detail in self.rows:
            if level != "PASS":
                print(f"{level:6} {phase:10} {what}" + (f"  — {detail}" if detail else ""))
        return n["BUG"]
