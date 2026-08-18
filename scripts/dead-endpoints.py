#!/usr/bin/env python3
"""
Do the clients and the API still agree?

    python3 scripts/dead-endpoints.py

Three questions, and they fail in opposite directions:

1. **A route no client calls.** Capability nobody can reach. Costs nothing until
   somebody needs it.
2. **A call no route serves.** A screen that 404s in a customer's hand. This is
   the expensive one, and it is the one a typecheck cannot see: the clients
   describe the API in their own hand-written types, so a path renamed on the
   server still compiles perfectly on the client.
3. **A call to a real route with the wrong verb.** A 405, which reads to a
   shopkeeper as "the button does nothing".

Question 1 is why this was written. Questions 2 and 3 were added on 2026-08-18
after `HANDOVER.md` recorded that three mobile contracts had "moved under" the
app — `item_types`, `other_income`, `logo_url`. Nothing had ever checked, and the
mobile app's own suite cannot: it mocks the API, so it agrees with whatever the
app believes.

── Why this is a script and not a test ─────────────────────────────────

`tests/Unit/ReachableTest.php` asks the same question INSIDE this repo and can
therefore run on every commit. This one has to read the panel and the mobile app,
which are separate git repositories checked out beside this one. A test that
fails because a sibling directory is missing would get switched off within a
week, so this stays a tool you run deliberately and read with your own eyes.

Run it after adding endpoints, and when auditing. It found `DELETE
/customer/reviews/{id}` — a customer could post a review and never take it down,
because the endpoint was written, tested, and called by no screen.

── What it gets wrong, in both directions ──────────────────────────────

FALSE POSITIVES — reported dead, actually alive. A client that builds its path
from a variable (`apiGet(`${basePath}/presets`)`) does not contain the literal
route. The matcher retries with the leading segments wildcarded, which catches
most of them, but a path assembled from several variables will still be missed.
The first run of this reported five and THREE were this.

FALSE NEGATIVES — reported alive, actually dead. A route parameter matches any
single segment, so `products/{product}` is satisfied by a client calling
`/products/import`. Sibling routes cover for each other. And an IMPORT path
reads like an API path: `import { hintFor } from "../staff/permissions"` looks
exactly like a call to `staff/permissions`.

So: every finding needs checking by hand, and a clean result is not proof. What
it is good for is turning three hundred routes into a list short enough to read.
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIBLINGS = os.path.dirname(ROOT)

# Every repo that could hold a caller. A missing one is reported rather than
# ignored: a "clean" run that silently read nothing is the worst possible
# outcome for a tool like this.
CLIENTS = [
    (os.path.join(SIBLINGS, "shopos-admin-and-user-panel"), "src"),
    (os.path.join(SIBLINGS, "shopos-mobile"), ""),
]

SKIP_DIRS = {"node_modules", "dist", "build", ".git", "ios", "android", ".next"}
CODE_EXT = (".ts", ".tsx", ".js", ".jsx", ".dart", ".vue")

PARAM = r"[^/'\"`)\s]+"


def client_source() -> str:
    blob, files, missing = [], 0, []

    for base, sub in CLIENTS:
        root = os.path.join(base, sub)
        if not os.path.isdir(root):
            missing.append(base)
            continue
        for dirpath, dirnames, names in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in names:
                if name.endswith(CODE_EXT):
                    path = os.path.join(dirpath, name)
                    try:
                        blob.append(open(path, encoding="utf-8", errors="ignore").read())
                        files += 1
                    except OSError:
                        pass

    if missing:
        print("NOT CHECKED (not cloned here):", ", ".join(missing), file=sys.stderr)
    print(f"read {files} client files", file=sys.stderr)

    if files == 0:
        sys.exit("no client source found — every route would look dead")

    return "\n".join(blob)


def patterns(uri: str) -> list[str]:
    """The literal path, then the same path with its head wildcarded.

    The second form is what finds a call built on a variable base path. It stops
    before the tail gets short enough to match anything: a three-letter segment
    is a coincidence waiting to happen.

    The threshold was 8 for one run, which is one character longer than
    `presets` — so `staff/presets` was reported dead while `useJobPresets` was
    calling it through a variable base path. A cutoff is a guess; this one is
    written down so the next person can see what it costs.
    """
    parts = [PARAM if s.startswith("{") else re.escape(s) for s in uri[len("api/v1/"):].split("/")]

    out = ["/".join(parts)]
    for cut in range(1, len(parts)):
        tail = parts[cut:]
        static = "".join(p for p in tail if p != PARAM)
        if len(static) >= 6:
            out.append(PARAM + "/" + "/".join(tail))

    return out


# How a client writes a call. Every helper in both apps funnels through one of
# these, which is what makes the question answerable at all.
CALL = re.compile(r"api(Get|Post|Put|Patch|Delete)(?:<[^>]*>)?\(\s*[`\"']([^`\"']*)")

# `${...}` is one path segment whose value is unknown. Substituting a literal
# means a route parameter matches it and a static segment does not, which is
# exactly the right behaviour: `/products/${id}` should satisfy
# `products/{product}` and nothing else.
INTERPOLATION = re.compile(r"\$\{[^}]*\}")


def route_matchers(routes: list[dict]) -> list[tuple[str, set[str], re.Pattern]]:
    """Every api/v1 route as (path, verbs, a regex that matches a client path)."""
    out = []
    for route in routes:
        uri = route["uri"]
        if not uri.startswith("api/v1/"):
            continue
        path = "/" + uri[len("api/v1/"):]
        segments = [r"[^/]+" if s.startswith("{") else re.escape(s) for s in path.strip("/").split("/")]
        verbs = set(route["method"].split("|")) - {"HEAD"}
        out.append((path, verbs, re.compile("^/" + "/".join(segments) + "$")))
    return out


def client_calls() -> tuple[dict[tuple[str, str], set[str]], int]:
    """Every (verb, path) literal a client passes to an api helper.

    TEST FILES ARE EXCLUDED, unlike question 1. A test may legitimately name a
    path that no route serves — that is how you assert a 404 — and counting it
    would make the check report a defect for a test doing its job.
    """
    calls: dict[tuple[str, str], set[str]] = {}
    skipped = 0

    for base, sub in CLIENTS:
        root = os.path.join(base, sub)
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, names in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and d != "__tests__"]
            for name in names:
                if not name.endswith(CODE_EXT) or ".test." in name:
                    continue
                full = os.path.join(dirpath, name)
                try:
                    text = open(full, encoding="utf-8", errors="ignore").read()
                except OSError:
                    continue
                for verb, raw in CALL.findall(text):
                    path = raw.split("?")[0]
                    # A path assembled from a variable HEAD cannot be resolved
                    # here. Counted rather than dropped: a checker that silently
                    # discards what it cannot read reports a clean sweep it did
                    # not earn.
                    if not path.startswith("/"):
                        skipped += 1
                        continue
                    calls.setdefault((verb.upper(), path), set()).add(
                        os.path.relpath(full, SIBLINGS)
                    )

    return calls, skipped


def check_calls(routes: list[dict]) -> None:
    """Questions 2 and 3: a call with no route, and a call with the wrong verb."""
    matchers = route_matchers(routes)
    calls, skipped = client_calls()

    orphans, wrong_verb, agreed = [], [], 0

    for (verb, path), files in sorted(calls.items()):
        probe = INTERPOLATION.sub("PLACEHOLDER", path)
        hits = [(p, verbs) for p, verbs, rx in matchers if rx.match(probe)]

        if not hits:
            orphans.append((verb, path, sorted(files)))
        elif any(verb in verbs for _, verbs in hits):
            agreed += 1
        else:
            allowed = sorted({v for _, verbs in hits for v in verbs})
            wrong_verb.append((verb, path, allowed, sorted(files)))

    total = len(calls)
    print(f"\n{total} call sites read ({skipped} unresolvable, built from a variable head)")
    print(f"  {agreed} agree with a route  ·  {len(orphans)} hit nothing  ·  {len(wrong_verb)} wrong verb")

    if total == 0:
        sys.exit("no api calls found — the matcher is broken, not the code")

    for verb, path, files in orphans:
        print(f"\nNO ROUTE   {verb:6} {path}")
        for f in files[:3]:
            print(f"           {f}")

    for verb, path, allowed, files in wrong_verb:
        print(f"\nWRONG VERB {verb:6} {path}   route allows {'/'.join(allowed)}")
        for f in files[:3]:
            print(f"           {f}")

    if not orphans and not wrong_verb:
        print("\nEvery resolvable call reaches a route that serves that verb.")


def main() -> None:
    routes = json.loads(
        subprocess.run(
            ["php", "artisan", "route:list", "--json"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout
    )

    blob = client_source()

    seen, dead = set(), []
    for route in routes:
        uri = route["uri"]
        if not uri.startswith("api/v1/") or uri in seen:
            continue
        seen.add(uri)

        if not any(re.search(p, blob) for p in patterns(uri)):
            dead.append((route["method"].split("|")[0], uri, route["action"].split("\\")[-1]))

    print(f"\n{len(dead)} of {len(seen)} api/v1 routes have no caller in any client")
    print("Check every one by hand — see the note on false positives above.\n")
    for method, uri, action in sorted(dead, key=lambda r: r[1]):
        print(f"{method:6} {uri:58} {action}")

    check_calls(routes)


if __name__ == "__main__":
    main()
