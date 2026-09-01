#!/usr/bin/env python3
"""
THE DOOR THE SCREEN USES MUST BE THE DOOR UNDER TEST.

The Suppliers list has a Pay button. It sends an amount and a method — there is
no order picker on it and never has been. Every payment test in the suite sent
`purchase_order_id` as well, so the only door under test was the one the UI does
not use. Through the real one the server filed the payment, took the cash out of
the drawer, and applied it to no order at all: the balance did not move, and the
shopkeeper paid again. Two thousand green tests, and the path a person actually
walks had never been walked.

The shape of that fault is general and mechanical:

    an OPTIONAL field that every test supplies

Its absence is a different branch — `if (! empty($data['purchase_order_id']))`
is a fork in the road — and a fork nobody drives down is a fork nobody has seen.

So: for every write endpoint, this asks whether any test omits each of its
optional fields. It reports the ones where the answer is no.

It is deliberately noisy about its own denominators. A scanner that quietly
stops matching reports a clean sheet, which is the failure this codebase keeps
meeting; every stage below prints what it found, and `--check` fails when a
stage finds suspiciously little.
"""
from __future__ import annotations

import collections
import json
import subprocess
import pathlib
import re
import sys

ROUTES = pathlib.Path("routes/api.php")
CONTROLLERS = pathlib.Path("app/Http/Controllers")
REQUESTS = pathlib.Path("app/Http/Requests")
TESTS = pathlib.Path("tests")

# Fields whose absence is never interesting: the client is not expected to send
# them, or their absence is the ordinary case already covered everywhere.
BORING = {
    "idempotency_key",   # only the offline queue sends one
    "per_page", "page", "search", "sort", "filter",
}


def optional_fields(request_src: str) -> set[str]:
    """Top-level fields a caller may leave out entirely."""
    out: set[str] = set()
    for m in re.finditer(r"'([a-z0-9_]+)'\s*=>\s*\[([^\]]*)\]", request_src):
        field, rules = m.group(1), m.group(2)
        if "." in field or "*" in field:
            continue                      # nested — a different question
        if re.search(r"'required'", rules):
            continue                      # must always be sent
        if re.search(r"'required_(?:with|without|if|unless)", rules):
            # Conditionally required — `'email' => ['nullable',
            # 'required_without:phone']` is not a field a caller may simply
            # drop, and reporting it is noise that teaches people to ignore
            # this list.
            continue
        if re.search(r"'nullable'|'sometimes'", rules):
            out.add(field)

    return out - BORING


def route_table() -> list[tuple[str, str, str, str]]:
    """(verb, full uri, ControllerName, action), asked of the framework.

    Parsed by hand at first, and that version was wrong in the quiet way: the
    route file nests `Route::prefix(...)->group(...)`, so a literal read of
    `Route::post('adjust', ...)` yields "adjust" while every test posts to
    "inventory/adjust". Nothing matched, most joins failed, and the scanner
    reported one finding with great confidence. Laravel already knows the
    answer — ask it.
    """
    out = subprocess.run(
        ["php", "artisan", "route:list", "--json"],
        capture_output=True, text=True, check=True,
    )
    rows = json.loads(out.stdout)
    table: list[tuple[str, str, str, str]] = []
    for r in rows:
        verbs = [v for v in r["method"].split("|") if v in ("POST", "PUT", "PATCH")]
        action = r.get("action") or ""
        if "@" not in action:
            continue
        cls, method = action.rsplit("@", 1)
        for v in verbs:
            table.append((v.lower(), r["uri"], cls.rsplit("\\", 1)[-1], method))

    return table


def action_requests() -> dict[tuple[str, str], str]:
    """(ControllerName, action) -> FormRequest class name."""
    known = {p.stem for p in REQUESTS.rglob("*.php")}
    out: dict[tuple[str, str], str] = {}
    for p in CONTROLLERS.rglob("*.php"):
        src = p.read_text()
        for m in re.finditer(r"public function (\w+)\s*\(([^)]*)\)", src, re.S):
            for r in re.findall(r"\b(\w*Request)\s+\$", m.group(2)):
                if r in known:
                    out[(p.stem, m.group(1))] = r

    return out


def normalise(uri: str) -> str:
    """Both sides of the comparison reduced to the same shape."""
    uri = uri.strip().strip("/")
    uri = re.sub(r"^api/v1/?", "", uri)
    uri = re.sub(r"\{[^}]*\}", "*", uri)          # {supplier} and {$id} alike
    uri = re.sub(r"'\s*\.\s*\$[A-Za-z0-9_>\[\]'\-()]+\s*\.\s*'", "*", uri)
    uri = re.sub(r"'\s*\.\s*\$[A-Za-z0-9_>\[\]'\-()]+", "*", uri)
    uri = re.sub(r"\?.*$", "", uri)

    return uri.strip("/")


def top_level_keys(src: str, start: int) -> set[str] | None:
    """Keys at depth 1 of the array literal beginning at `start`."""
    depth, i, keys = 0, start, set()
    while i < len(src):
        ch = src[i]
        if ch in "[(":
            depth += 1
        elif ch in "])":
            depth -= 1
            if depth == 0:
                return keys
        elif depth == 1 and ch in "'\"":
            m = re.match(r"['\"]([a-z0-9_]+)['\"]\s*=>", src[i:])
            if m:
                keys.add(m.group(1))
        i += 1

    return None


def test_calls() -> dict[str, list[set[str]]]:
    """Normalised uri -> the key-sets tests post to it."""
    calls: dict[str, list[set[str]]] = collections.defaultdict(list)
    verb = re.compile(r"->(?:postJson|putJson|patchJson|post|put|patch)\(\s*")

    # A VERB AND A URL HANDED TO A HELPER.
    #
    # The regex above finds `->putJson('/api/v1/branches/…')` and nothing else,
    # which was true of every test in the suite until a matrix arrived that
    # dispatches through `->{$verb.'Json'}($url)` — one helper, twelve
    # endpoints. Those calls are invisible to a scan looking for a literal verb
    # beside a literal path, so this report said thirteen routes had no test
    # while EditMatrixTest was posting to twelve of them.
    #
    # That is worse than a miss. The next person reads the list and writes the
    # tests a second time. So the other shape is recognised too: a verb string
    # and a path passed together as arguments.
    #
    # The general answer is not a regex at all — record the routes the SUITE
    # actually hits at runtime and compare that. Until then, this covers the
    # shape that exists.
    handed = re.compile(
        r"""['\"](post|put|patch)['\"]\s*,\s*['\"]([^'\"]*/[^'\"]*)['\"]"""
    )

    for p in TESTS.rglob("*.php"):
        src = p.read_text()
        for m in handed.finditer(src):
            uri = normalise(m.group(2))
            if uri:
                # The body sits somewhere further along the argument list and is
                # not worth guessing at. An empty key-set says "this route is
                # posted to" without claiming which fields were sent.
                calls[uri].append(set())
        for m in verb.finditer(src):
            rest = src[m.end():]
            u = re.match(r"""(['"])(.+?)\1""", rest, re.S)
            if not u:
                continue
            uri = normalise(u.group(2))
            if not uri:
                continue
            after = m.end() + u.end()
            nxt = re.match(r"\s*,\s*", src[after:])
            if not nxt:
                calls[uri].append(set())        # posted with no body at all
                continue
            body_at = after + nxt.end()
            if src[body_at] != "[":
                calls[uri].append(set())
                continue
            keys = top_level_keys(src, body_at)
            if keys is not None:
                calls[uri].append(keys)

    return calls


def main() -> int:
    check = "--check" in sys.argv
    routes = route_table()
    reqs = action_requests()
    calls = test_calls()

    print(f"{len(routes)} write routes · {len(reqs)} actions behind a FormRequest "
          f"· {sum(len(v) for v in calls.values())} test calls across {len(calls)} paths")

    # The denominators. Each of these silently becoming zero is how a scanner
    # starts reporting a clean sheet about nothing.
    if len(routes) < 100 or len(reqs) < 60 or len(calls) < 100:
        print("\nA STAGE FOUND ALMOST NOTHING — the parser has drifted, not the code.")
        return 2

    gaps: list[tuple[str, str, str, int]] = []
    examined = 0
    untested_routes: list[str] = []

    for verb, uri, ctrl, action in routes:
        request = reqs.get((ctrl, action))
        if request is None:
            continue
        src = next(REQUESTS.rglob(f"{request}.php"), None)
        if src is None:
            continue
        fields = optional_fields(src.read_text())
        if not fields:
            continue

        key_sets = calls.get(normalise(uri))
        if not key_sets:
            untested_routes.append(f"{verb.upper():5} {normalise(uri)}")
            continue

        for field in sorted(fields):
            examined += 1
            if all(field in ks for ks in key_sets):
                gaps.append((f"{verb.upper()} /{normalise(uri)}", field, request, len(key_sets)))

    print(f"{examined} (endpoint, optional field) pairs examined")

    if untested_routes:
        print(f"\n{len(untested_routes)} write routes no test posts to at all:")
        for r in sorted(set(untested_routes)):
            print(f"  {r}")

    if gaps:
        print(f"\n{len(gaps)} OPTIONAL FIELDS THAT EVERY TEST SUPPLIES")
        print("(their absence is a branch nobody has driven down)\n")
        for route, field, request, n in sorted(gaps):
            print(f"  {route}")
            print(f"      '{field}' present in all {n} test call(s) — {request}")
    else:
        print("\nEvery optional field is omitted by at least one test.")

    if check:
        return 1 if gaps else 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
