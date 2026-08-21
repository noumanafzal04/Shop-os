#!/usr/bin/env python3
"""
Rows the shop cannot reach.

Thirty-seven endpoints paginate. A screen that lists one and never asks for a
page shows the first page and nothing else — and there is no error, no empty
state, no hint. It looks exactly like a shop that has that many rows.

That is how ten reviews a page meant a shop with eleven could never read its
first one, and how a coupon list capped at thirty left older codes with no way
to expire, correct or delete them. Both had shipped, both were invisible from
either repository alone: the backend paginates correctly, the panel renders
correctly, and the defect lives in the gap.

    python3 unreachable-pages.py            report
    python3 unreachable-pages.py --prove    break itself on purpose first

── Why this is not a panel test ────────────────────────────────────────────

`components/ui/pager/reach.test.ts` keeps the panel's half true: nobody writes
their own Previous/Next. It deliberately cannot answer "does every list have
one", because that needs the list of paginating endpoints, which lives in the
backend. A copy of that list inside the panel would be a second answer to one
question — the fault this whole file exists to catch.

So this reads both repositories, like `dead-endpoints.py` next door.

── What it still cannot tell you ───────────────────────────────────────────

The escape hatch is credited to a FOLDER, not to a LIST. A folder that shows
two paginated lists and puts a search box on one of them reads as covered for
both. That is how `modules/workshop` came back "search only" the first time it
was ever judged: the search it was credited for is a product lookup inside the
book-in modal, and the list actually at risk was the job-card board beside it.

Fixing that properly needs per-list attribution — which call feeds which
screen — and the folder is the wrong unit for it. Left as a known limit rather
than papered over, because a scanner whose limits are written down can be
trusted about the rest.

── The denominator ─────────────────────────────────────────────────────────

Every count here is printed over its total, and `--prove` breaks the detector
on purpose to show it can still fail. A scanner that reports "0 problems"
because its glob matched nothing looks identical to a clean sweep.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "shopos-backend"
PANEL = ROOT / "shopos-admin-and-user-panel"

# A screen may reach a later row two ways, and either is enough: turn the page,
# or search for it by name. Neither is a substitute for the other — search
# cannot browse and paging cannot find — but a shop with one of them is not
# stuck, and this file is about being stuck.
API_CALL = re.compile(
    r'api(?:Get|Post|Put|Patch|Delete)\s*(?:<[^>]*>)?\s*\(\s*["\'`]/([a-z][\w\-]*(?:/[\w\-${}.]+)*)'
)

TURNS_THE_PAGE = re.compile(r"<Pager\b")
ASKS_BY_NAME = re.compile(r"\bsearch\s*[:=]|placeholder=\"Search")
# A third honest answer: don't page it, DRAIN it. A working surface — a kanban
# board, a floor plan — is not a list you browse, and paging one splits its
# columns arbitrarily. Reading `last_page` inside a loop reaches every row, so
# it is not stuck; it just gets there a different way.
DRAINS_EVERY_PAGE = re.compile(r"last_page\b[\s\S]{0,400}?\bfor\s*\(|\bfor\s*\([\s\S]{0,400}?last_page\b")


def paginating_routes() -> set[str]:
    """
    Every URI whose controller method calls ApiResponse::paginated.

    The URIs come from `php artisan route:list`, not from reading
    `routes/api.php`. The first version parsed the file and lost every
    `Route::prefix(...)` — it stored `transfers` where the real path is
    `inventory/transfers`, so eight routes matched no screen at all and the
    modules that list them were never checked. The report said "1 of 12" and
    looked healthy; the twelve was the lie.

    Laravel already knows the answer. Ask it.
    """
    methods: set[str] = set()
    for f in (BACKEND / "app/Http/Controllers/Api/V1").rglob("*.php"):
        src = f.read_text()
        for m in re.finditer(
            r"public function (\w+)\([^)]*\)\s*:\s*JsonResponse\s*\{(.*?)\n    \}", src, re.S
        ):
            if "ApiResponse::paginated" in m.group(2):
                methods.add(f"{f.stem}@{m.group(1)}")

    listing = subprocess.run(
        ["php", "artisan", "route:list", "--json"],
        cwd=BACKEND, capture_output=True, text=True,
    )
    if listing.returncode != 0:
        raise SystemExit(f"could not read the route list:\n{listing.stderr[:400]}")

    found = set()
    for r in json.loads(listing.stdout):
        action = (r.get("action") or "").split("\\")[-1]
        if action in methods:
            found.add(re.sub(r"^api/v1/", "", r["uri"]).strip("/"))

    if not methods or not found:
        raise SystemExit("read no paginating routes at all — the parser is broken, not the code")

    return found


def screens() -> list[tuple[str, str, str]]:
    """
    (name, its own source, its source plus whatever imports it).

    Two different texts, answering two different questions, and conflating them
    broke this scan twice:

      WHAT IT LISTS   comes from the folder's OWN source only. Fold importers
                      in here and `components/ui` — which every admin page
                      imports a Button from — is credited with listing the
                      tenant list, the audit log and the staff directory. It
                      lists nothing; it is a button.

      CAN IT REACH    comes from the folder plus one hop of importers, because
                      a feature is not always one folder. The notification bell
                      FETCHES in `modules/notifications` and RENDERS in
                      `components/header`. Judged on its own text the module
                      has a query and no pager and looked broken after it had
                      been fixed.

    One hop, and no further: the transitive closure of a React app is the React
    app, and a scan that folds everything into one blob reports everything as
    fine.
    """
    roots = [PANEL / "src/modules", PANEL / "src/components"]
    folders = [(f"{root.name}/{d.name}", d)
               for root in roots for d in sorted(p for p in root.iterdir() if p.is_dir())]

    def body(d: Path) -> str:
        return "\n".join(
            f.read_text() for f in list(d.rglob("*.ts")) + list(d.rglob("*.tsx"))
            if ".test." not in f.name
        )

    everything = [(f, f.read_text()) for f in (PANEL / "src").rglob("*.tsx")
                  if ".test." not in f.name]

    # ── Every service in the panel, by file name ────────────────────────
    #
    # A THIRD case, and the one that hid a real bug for as long as this scanner
    # has existed. "What it lists" reads a folder's OWN source, which is right
    # for keeping `components/ui` from being credited with every list that
    # imports a Button from it — and wrong for a folder that lists through
    # SOMEBODY ELSE'S service.
    #
    # `modules/workshop` is exactly that. The bay board fetches
    # `documentService.list({ kind: "job_card" })`, and `documentService` lives
    # in `modules/documents`. So the workshop folder contains no `apiGet` at
    # all, `lists` came back empty, `continue` fired, and the folder was never
    # judged — while the credit for `/sale-documents` went to
    # `modules/documents`, which passes on its search box.
    #
    # The board was reading page one of 25 newest-first job cards and bucketing
    # them into three columns, so a workshop with 26 open jobs lost the oldest
    # car — the one the board itself colours amber as overdue. A page-two defect,
    # inside the blind spot of the scanner written to find page-two defects.
    #
    # Narrow on purpose, so the `components/ui` lesson is not undone: only files
    # under a `services/` directory, and only when the folder actually CALLS the
    # symbol it imported. A Button is not a service and is never called with a
    # dot after it.
    services = {f.stem: f.read_text()
                for f in (PANEL / "src").rglob("services/*.ts")
                if ".test." not in f.name}
    borrows = re.compile(r'import\s*\{([^}]*)\}\s*from\s*"[^"]*services/([\w.-]+)"')

    def borrowed(own: str, d: Path) -> str:
        """Sources of services this folder imports from elsewhere AND calls."""
        mine = {f.stem for f in d.rglob("services/*.ts")}
        out = []
        for symbols, module in borrows.findall(own):
            if module in mine or module not in services:
                continue
            # Called, not merely imported. `documentService.list(` counts;
            # a type-only import of `SaleDocument` does not.
            if any(re.search(rf"\b{re.escape(sym.strip())}\s*\.", own)
                   for sym in symbols.split(",") if sym.strip()):
                out.append(services[module])
        return "\n".join(out)

    out = []
    for name, d in folders:
        own = body(d)
        own += "\n" + borrowed(own, d)
        needle = f"/{d.parent.name}/{d.name}/"
        importers = "\n".join(
            src for f, src in everything
            if d not in f.parents and re.search(rf'from "[^"]*{re.escape(needle)}', src)
        )
        out.append((name, own, own + "\n" + importers))
    return out


def report(mutate: str | None = None) -> int:
    routes = paginating_routes()
    mods = screens()

    print(f"{len(routes)} paginating routes · {len(mods)} panel folders\n")

    stuck, checked, listed = [], 0, set()
    for name, own, reach in mods:
        if mutate == "blind":
            own = reach = ""  # the detector, told to look at nothing
        # ONLY the API client's own calls. Matching any string beginning with
        # a slash also matched `to="/admin/tenants"` — a router link — and
        # accused the admin DASHBOARD of failing to page the tenant list it
        # merely links to. A navigation target is not a fetch.
        calls = set(re.findall(API_CALL, own))

        # Some services take the path in a VARIABLE — the staff hook is CRUD
        # against a `basePath` that is "/staff" for a shop and "/admin/staff"
        # for the console, one implementation for two surfaces. The regex above
        # cannot see through that, and reported both routes as belonging to no
        # screen at all. Where a folder calls the client with something other
        # than a literal, its quoted paths count too — narrower than scanning
        # every string, because only a folder that actually fetches qualifies.
        if re.search(r"api(?:Get|Post|Put|Patch|Delete)\s*(?:<[^>]*>)?\s*\(\s*[A-Za-z`$]", own):
            calls |= set(re.findall(r'["\'`](/[a-z][\w\-/]*)["\'`]', own)) | {
                m.lstrip("/") for m in re.findall(r'["\'`](/[a-z][\w\-/]*)["\'`]', own)
            }
        # EXACT, never a prefix. `/products/{id}/branch-prices` is a
        # sub-resource of one product, not the product LIST — counting it as
        # one accused the branches module of failing to page a list it never
        # shows. A prefix match makes every nested route look like its parent.
        lists = sorted({r for r in routes for c in calls if c == r})
        if not lists:
            continue
        checked += 1
        listed.update(lists)
        pages = bool(TURNS_THE_PAGE.search(reach))
        finds = bool(ASKS_BY_NAME.search(reach))
        drains = bool(DRAINS_EVERY_PAGE.search(reach))
        if pages or finds or drains:
            how = "pages" if pages else "drains all" if drains else "search only"
            print(f"  ok    {name:14} {how:12} {','.join(lists[:3])}")
        else:
            stuck.append((name, lists))
            print(f"  STUCK {name:14} {'neither':12} {','.join(lists[:3])}")

    print(f"\n{len(stuck)} of {checked} folders that list a paginated endpoint cannot reach row two")
    for name, lists in stuck:
        print(f"  · {name}: {', '.join(lists)}")

    # THE OTHER DENOMINATOR. A paginating route no screen names is either a
    # list nobody built yet or a path this scan failed to recognise, and the
    # two look identical from here — which is exactly why they get printed
    # rather than quietly dropped out of the count above.
    quiet = sorted(routes - listed)
    print(f"\n{len(quiet)} of {len(routes)} paginating routes are named by no screen:")
    for q in quiet:
        print(f"  · {q}")

    return len(stuck), checked, len(quiet), len(routes)


def prove() -> int:
    """
    Blind the detector and require the result to LOOK blind.

    A scan that reads nothing reports "0 problems", which is character for
    character what a clean sweep reports. The only thing that tells them apart
    is the denominator — so this run asserts on the denominator and never on
    the verdict.
    """
    print("── proving it can fail ──\n")
    _, checked, quiet, routes = report(mutate="blind")

    if checked != 0 or quiet != routes:
        print("\nBROKEN: a detector reading nothing still found screens to judge")
        return 1

    print(f"\nblinded: checked 0 folders and could place none of {routes} routes.")
    print("That is the shape a broken scan takes. A real run below that checks 0")
    print("is broken too, whatever its verdict says.\n")

    stuck, checked, quiet, routes = report()

    if checked == 0:
        print("\nBROKEN: the real run judged nothing either")
        return 1

    return 1 if stuck else 0


if __name__ == "__main__":
    if "--prove" in sys.argv:
        raise SystemExit(prove())

    stuck, checked, _quiet, _routes = report()
    raise SystemExit(1 if (stuck or checked == 0) else 0)
