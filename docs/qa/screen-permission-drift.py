#!/usr/bin/env python3
"""
The rule the panel enforces, against the rule the server has.

    python3 screen-permission-drift.py            report
    python3 screen-permission-drift.py --prove    break itself on purpose first

── The promise ─────────────────────────────────────────────────────────────

`src/common/routing/screenPermissions.ts` opens with a claim about itself:

    "The permission named here is the one the SERVER asks for on that screen's
     own action (see routes/api.php). Nothing invents a rule the API does not
     have, and nothing quietly drops one it does."

Nothing checked it. The map's own test names `TENANT_PERMISSIONS` as a
hand-copied set of seventeen strings — a second copy of `App\\Support\\Permissions`
living in the other repository — and compares against it with
`permissionForScreen`, which returns the FIRST permission of an ANY-of list and
never looks at the rest. A promise stated in one file and implemented nowhere is
this codebase's most repeated defect, and it reads as DONE.

── What drift costs, in both directions ────────────────────────────────────

LOCKED OUT   the server would serve this person and the panel never offers them
             the screen. Silent: no error, no empty state, just a missing menu
             item. This is the "built but unreachable" class, hit seven times.

DEAD END     the panel offers the screen to somebody every one of its own reads
             refuses. They click, the API says 403, the guard bounces them to
             the dashboard, and nothing explains why.

── How a screen is judged ──────────────────────────────────────────────────

    App.tsx     /tenant/products  →  <ProductsPage/>  →  modules/catalog/pages/…
    that file   plus the module files it imports, for the GETs it makes
    the server  `php artisan route:list --json`, for the permission each GET
                is actually behind

A person can OPEN a screen iff they hold a permission that satisfies EVERY read
it makes — an intersection of ANY-of sets, because one refused read is a broken
screen. That intersection is what the panel's rule is compared against.

── The denominator ─────────────────────────────────────────────────────────

Screens whose reads cannot be resolved are COUNTED and named, never silently
dropped. A scanner reporting "0 problems" because its regex matched nothing
looks exactly like a clean run — which is why `--prove` breaks this one on
purpose and the run fails if the break goes unnoticed.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "shopos-backend"
PANEL = ROOT / "shopos-admin-and-user-panel"
APP = PANEL / "src/App.tsx"
MAP = PANEL / "src/common/routing/screenPermissions.ts"

# `apiGet<Row[]>("/products?…")` — the method matters, because opening a screen
# is a read. A screen whose WRITE needs more than its read is correct and
# common: the products list is `READS_CATALOG`, saving one is `products.manage`.
API_GET = re.compile(r'apiGet\s*(?:<[^>]*>)?\s*\(\s*[`"\']([^`"\'?]+)')
LAZY = re.compile(r'const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\(\s*["\']([^"\']+)["\']')
ROUTE = re.compile(r'<Route\s+path="(/tenant[^"]*)"\s+element=\{<(\w+)\s*/?>')
IMPORT = re.compile(r'from\s+["\'](\.[^"\']+)["\']')
ENTRY = re.compile(r'^\s*"(/tenant[^"]*)":\s*(\[[^\]]*\]|"[^"]*")', re.M)


def tenant_permissions() -> set[str]:
    """The shop-side half of the server's registry, read from the registry."""
    src = (BACKEND / "app/Support/Permissions.php").read_text()
    # Only the simple `= 'x.y';` constants. The ANY-of ones are concatenations
    # of these, so they add no new names.
    keys = set(re.findall(r"public const \w+ = '([a-z_]+\.[a-z_]+)';", src))
    platform = {k for k in keys if k.split(".")[0] in
                {"tenants", "billing", "platform_staff", "banners", "announcements"}}

    return keys - platform


def server_gates() -> list[tuple[str, frozenset | None]]:
    """
    Every GET route, with the permission set that opens it.

    From `route:list`, not from reading routes/api.php: the file is full of
    `Route::prefix(...)` and `'permission:'.Permissions::READS_CATALOG`, and a
    parser that loses either stores the wrong path behind the wrong rule.
    Laravel already knows both. `None` means the route names no permission.
    """
    out = subprocess.run(["php", "artisan", "route:list", "--json"],
                         cwd=BACKEND, capture_output=True, text=True)
    rows = json.loads(out.stdout)

    gates = []
    for r in rows:
        if "GET" not in (r.get("method") or ""):
            continue
        uri = r.get("uri") or ""
        if not uri.startswith("api/v1/"):
            continue
        perms = None
        for m in r.get("middleware") or []:
            if "EnsurePermission:" in m:
                perms = frozenset(m.split("EnsurePermission:", 1)[1].split(","))
        gates.append((uri[len("api/v1/"):], perms))

    return gates


def _shape(path: str) -> tuple[str, ...]:
    """A path as segments, with anything substituted-in reduced to a wildcard."""
    segs = []
    for s in path.strip("/").split("/"):
        segs.append("*" if ("$" in s or s.startswith("{")) else s)

    return tuple(segs)


def gate_for(call: str, gates: list) -> frozenset | None | str:
    """The permission set behind one call, or 'unmatched'."""
    want = _shape(call)
    for uri, perms in gates:
        got = _shape(uri)
        if len(got) != len(want):
            continue
        if all(g == "*" or w == "*" or g == w for g, w in zip(got, want)):
            return perms

    return "unmatched"


def screens() -> dict[str, Path]:
    """
    Every shop screen App.tsx declares, and the file that draws it.

    The routes NEST — `<Route path="/tenant">` wrapping `<Route path="products">`
    — so a regex that reads one element at a time stores "products" and matches
    no rule at all. The first version of this file did exactly that and reported
    every screen unmeasured, which `--prove` caught before the tool was ever
    believed. Walking the tags with a stack is what fixes it.
    """
    src = APP.read_text()
    files = {name: rel for name, rel in LAZY.findall(src)}

    stack: list[str | None] = []
    out: dict[str, Path] = {}

    for m in re.finditer(r"<Route\b|</Route>", src):
        if m.group(0) == "</Route>":
            if stack:
                stack.pop()
            continue

        # Attributes run to the first `>` outside a JSX brace — `element={<X/>}`
        # contains one, and stopping at it truncates the tag.
        j, depth = m.end(), 0
        while j < len(src):
            c = src[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif c == ">" and depth == 0:
                break
            j += 1
        attrs, closed = src[m.end():j], src[j - 1] == "/"

        path = re.search(r'path="([^"]*)"', attrs)
        full = None
        if path:
            base = next((p for p in reversed(stack) if p), "")
            full = path.group(1) if path.group(1).startswith("/") \
                else base.rstrip("/") + "/" + path.group(1)

            comp = re.search(r"element=\{<(\w+)\s*/?>", attrs)
            rel = files.get(comp.group(1)) if comp else None
            if rel:
                p = (PANEL / "src" / rel.lstrip("./")).with_suffix(".tsx")
                out[full] = p if p.exists() else p.with_suffix(".ts")

        if not closed:
            stack.append(full)

    return out


def reads_of(page: Path, depth: int = 2) -> set[str]:
    """
    The GETs a screen makes, following its own module's imports.

    Two levels: a page imports its module's `api.ts`, which is where the calls
    live, and sometimes a component in between. Deeper than that and a shared
    hook would credit its callers with reads none of them make.
    """
    seen: set[Path] = set()
    calls: set[str] = set()

    def walk(f: Path, left: int) -> None:
        if f in seen or not f.exists():
            return
        seen.add(f)
        src = f.read_text()
        calls.update(API_GET.findall(src))
        if left == 0:
            return
        for rel in IMPORT.findall(src):
            target = (f.parent / rel).resolve()
            for cand in (target.with_suffix(".ts"), target.with_suffix(".tsx"),
                         target / "index.ts", target / "index.tsx"):
                if cand.exists() and PANEL in cand.parents:
                    walk(cand, left - 1)
                    break

    walk(page, depth)

    return {c for c in calls if c.startswith("/")}


def panel_rules() -> dict[str, set[str]]:
    """The map, read from the map — not a second copy of it."""
    src = MAP.read_text()

    return {path: set(re.findall(r'"([^"]+)"', rule))
            for path, rule in ENTRY.findall(src)}


# ── the screens whose rule is NOT one of their reads, and why ───────────
#
# Set equality against a read is the check; these are the honest exceptions,
# each named with its reason. A screen missing from here and from the reads is
# UNEXAMINED, and the run exits non-zero — the useful moment for this file is
# not the clean report, it is the day somebody adds the thirty-eighth screen.
EXPECTED = {
    "/tenant/fuel/setup":
        "the plant is CONFIGURED here — tanks, pumps and nozzles are writes on "
        "settings.manage, while reading them is READS_FORECOURT (four keys, "
        "because a shift and a delivery both need to see the kit)",
    "/tenant/reviews":
        "a shop's reviews are public and the read is open. Replying is the only "
        "thing anyone does on this screen, and the reply is the gated act",
    "/tenant/staff":
        "the screen's calls are built from a `${basePath}` that differs by "
        "console, so no literal path survives to be matched. Its rule is checked "
        "instead by PresetCanDoItsJobTest, from the server's side",
}


def main() -> int:
    prove = "--prove" in sys.argv

    tenant = tenant_permissions()
    gates = server_gates()
    rules = panel_rules()
    pages = screens()

    if prove:
        # Break the SUBJECT, not the detector: give one screen a rule the server
        # has never heard of. A scanner that still prints a clean run here is
        # measuring nothing, and would look identical on the day the map really
        # drifts. The first version of this file failed exactly here — its route
        # regex could not read a nested <Route>, so all 43 screens came back
        # unmeasured and the planted drift went unseen.
        rules["/tenant/products"] = {"reservations.manage"}
        print("--prove: /tenant/products re-labelled reservations.manage\n")

    agreed, findings, unexamined, unresolved = [], [], [], []

    for path in sorted(rules):
        want = set(rules[path])
        page = pages.get(path)
        if page is None:
            unresolved.append((path, "no route in App.tsx names a component"))
            continue

        sets, named, computed = [], set(), []
        for call in sorted(reads_of(page)):
            if not call.startswith("/"):
                computed.append(call)
                continue
            gate = gate_for(call, gates)
            if gate == "unmatched" or gate is None:
                continue
            sets.append(set(gate))
            named |= set(gate)

        if not sets:
            why = f"every read is open or computed ({', '.join(computed[:2]) or 'none matched'})"
            (unresolved if path in EXPECTED else unexamined).append((path, why))
            continue

        if want in sets:
            agreed.append(path)
            continue

        # The map names a key that gates NOTHING this screen reads. That is a
        # rule the API does not have — the one thing the map's own docblock
        # promises it never does.
        invented = want - named
        if invented:
            findings.append((path, sorted(want), sorted(invented)))
        elif path not in EXPECTED:
            unexamined.append((path, f"map={', '.join(sorted(want))}; no read is gated on exactly that"))

    total = len(rules)
    print(f"{len(agreed)} of {total} screens quote a rule the server actually has\n")

    for path, want, invented in findings:
        print(f"  INVENTED   {path:24} {', '.join(want)}")
        print(f"  {'':10} {'':24} — {', '.join(invented)} gates none of this screen's reads")

    for path, why in unexamined:
        print(f"  UNEXAMINED {path:24} {why}")
        print(f"  {'':10} {'':24} — add it to EXPECTED with the reason, or fix the map")

    if EXPECTED:
        print(f"\n{len(EXPECTED)} screen(s) deliberately not matched by a read:")
        for path, why in sorted(EXPECTED.items()):
            print(f"    · {path:22} {why}")

    if unresolved:
        print(f"\n{len(unresolved)} not measured — named rather than dropped:")
        for path, why in unresolved:
            print(f"    · {path:22} {why}")

    print()
    if prove:
        caught = any(f[0] == "/tenant/products" for f in findings)
        print("--prove: the planted drift WAS caught" if caught
              else "--prove: THE PLANTED DRIFT WAS MISSED — this tool proves nothing")
        return 0 if caught else 1

    problems = len(findings) + len(unexamined)
    print(f"{problems} screen(s) to answer for")

    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
