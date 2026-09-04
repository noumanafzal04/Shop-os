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

def _repo(*names: str) -> Path:
    """
    The app folder, whatever this machine calls it.

    These names were hard-coded to the ORIGINAL box —  `shopos-backend`,
    `shopos-admin-and-user-panel` — and on a machine that clones them as
    `backend` and `panel` this file did not run AT ALL. It crashed on a missing
    path, which is the good half; the bad half is that it had therefore never
    been run here, and a scanner that has never run is a scanner that is not
    protecting anything.

    Whichever name EXISTS wins. If none does, the first is returned so the
    failure still names something a person can look for.
    """
    for n in names:
        if (ROOT / n).is_dir():
            return ROOT / n
    return ROOT / names[0]


BACKEND = _repo("shopos-backend", "backend")
PANEL = _repo("shopos-admin-and-user-panel", "panel")
# THE OTHER CLIENT. The panel is not the only thing that calls this API, and a
# scan that only reads the panel calls a route "named by no screen" when the
# phone app has been using it all along. That is not a harmless overstatement:
# the natural next step from "nobody names it" is to delete it.
MOBILE = _repo("shopos-mobile", "mobile")

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


# ── The per-LIST question the folder check cannot ask ───────────────────
#
# The scan above credits an escape hatch to a FOLDER. A folder that shows two
# paginated lists and puts a search box on one of them reads as covered for
# both, and that limit is written into this file's own docblock.
#
# This is the other half, asked of the CALL rather than of the folder, and it
# needs no attribution at all: **can this list's request ask for anything but
# page one?** A call that sends no `page` and no `search` cannot reach row 31
# however many pagers are rendered somewhere in its folder. It is a necessary
# condition, not a sufficient one — the folder check still has to say whether a
# person can press anything.
#
# Its first two catches, both on the buyer's side of the marketplace:
#
#   /customer/reservations   `reservations: () => apiGet(...)` — no argument at
#                            all, against a server that has always answered
#                            paginate(15). A buyer with sixteen holds could not
#                            see the sixteenth or cancel it, and the ones that
#                            fall off are the OLDEST — exactly where a forgotten
#                            hold sits, with the shop still keeping stock off its
#                            shelf for it.
#
#   /customer/orders         the hook took a page and kept previous data; the
#                            SCREEN called it with none and rendered no pager.
#                            Built, tested, wired to nothing.
ASKS_FOR_A_PAGE = re.compile(r"\bpage\b")
ASKS_BY_NAME_TOO = re.compile(r"\bsearch\b|\bq\b\s*[:=]")
LITERAL_GET = re.compile(r'apiGet\s*(?:<[^>]*>)?\s*\(\s*[`"\']([^`"\'?]+)')
# `params: toParams(filters)` — the varying happens one function away, which is
# why a window around the call alone reported five false positives on the first
# run. Every one of them was a money list whose filters carry a page.
BUILDS_PARAMS = re.compile(r"params:\s*\{?\s*\.{0,3}\s*(\w+)\s*\(")


def _builders() -> dict[str, str]:
    """
    Sources to fold in when the varying happens somewhere other than the call.

    Two kinds, and the first run needed both — it reported six calls frozen and
    FIVE of them were the detector's fault:

      a params BUILDER — `params: toParams(filters)`, where `toParams` is the
      thing that writes `page`. Every false positive on the first run was a
      money list of exactly this shape.

      a filter TYPE — `disposals: (params: DisposalFilters = {}) => apiGet(…,
      { params })`. Nothing in the call names a page; `DisposalFilters` declares
      one and the caller supplies it.

    An audit that produces findings is a thing to verify, not to believe — and
    five of six is the ratio that makes the point.
    """
    out: dict[str, str] = {}
    for f in list((PANEL / "src").rglob("*.ts")) + list((PANEL / "src").rglob("*.tsx")):
        if ".test." in f.name:
            continue
        src = f.read_text()
        for m in re.finditer(r"export function (\w+)", src):
            out[m.group(1)] = src[m.start():m.start() + 1500]
        for m in re.finditer(r"(?:export )?(?:interface|type) (\w+)", src):
            out[m.group(1)] = src[m.start():m.start() + 1200]
    return out


def opt_in_routes(routes: set[str]) -> set[str]:
    """
    Routes that paginate only when ASKED to.

    `ExpenseCategoryController@index` says it plainly: "Opt-in, so the picker
    that has always received a flat array still does." A client that sends no
    `per_page` gets every row, so sending no page is correct there and flagging
    it is the scanner inventing a defect.
    """
    out: set[str] = set()
    methods: set[str] = set()
    for f in (BACKEND / "app/Http/Controllers/Api/V1").rglob("*.php"):
        src = f.read_text()
        for m in re.finditer(
            r"public function (\w+)\([^)]*\)\s*:\s*JsonResponse\s*\{(.*?)\n    \}", src, re.S
        ):
            body = m.group(2)
            if "ApiResponse::paginated" in body and "filled('per_page')" in body:
                methods.add(f"{f.stem}@{m.group(1)}")

    listing = subprocess.run(["php", "artisan", "route:list", "--json"],
                             cwd=BACKEND, capture_output=True, text=True)
    for r in json.loads(listing.stdout):
        if (r.get("action") or "").split("\\")[-1] in methods:
            out.add(re.sub(r"^api/v1/", "", r["uri"]).strip("/"))

    return out & routes


def _member_around(src: str, at: int) -> str:
    """
    The one service method the call belongs to — not a window of characters.
    
    A fixed window was the first attempt and it was blind. `marketplaceService`
    keeps `reservations` a few lines from a shop SEARCH, so 500 characters of
    context contained the word `search` and the call read as escapable. The
    detector answered "fine" about the very call the bug was in, twice, while I
    narrowed the wrong thing.
    
    A member of an object literal starts at a two-space-indented `name:` and
    ends where the next one starts. That is exactly the unit the question is
    about: what THIS call sends.
    """
    starts = [m.start() for m in re.finditer(r"\n  \w+:", src)]
    before = [p for p in starts if p <= at]
    after = [p for p in starts if p > at]
    lo = before[-1] if before else max(0, at - 400)
    hi = after[0] if after else min(len(src), at + 400)

    return src[lo:hi]


# ── Calls that are a SUMMARY, not a list ────────────────────────────────
#
# A handful of rows shown beside something else, with the full list one click
# away. Page two would be wrong here: a product form is not a place to browse.
#
# An entry is a CLAIM and has to be checked, not admired. `PriceHistory` earned
# its place only after the claim it rests on was made true — its own docblock
# said "the whole trail is still on Activity, filterable", and Activity could
# filter to Products but not to THIS product. The eleventh-oldest price change
# of one item meant paging every product change in the shop. The server had
# taken `?record=` since the panel was built and nothing passed it.
#
# So the rule for this dict: name the screen that shows the REST of it, and go
# and use it before adding the line.
A_SUMMARY_WITH_THE_REST_ELSEWHERE = {
    "src/modules/catalog/components/PriceHistory.tsx":
        "a handful of price changes beside the price field; the rest is on "
        "Activity, narrowed to this item, linked from the panel itself",
}


def frozen_on_page_one(routes: set[str]) -> tuple[list[tuple[str, str]], int]:
    """(route, file) for every call whose request cannot vary, and how many were judged."""
    builders = _builders()
    routes = routes - (opt_in_routes(routes) if routes else set())
    stuck, judged = [], 0

    for f in sorted((PANEL / "src").rglob("*.ts")) + sorted((PANEL / "src").rglob("*.tsx")):
        if ".test." in f.name:
            continue
        src = f.read_text()
        for m in LITERAL_GET.finditer(src):
            if m.group(1).lstrip("/") not in routes:
                continue
            judged += 1
            window = _member_around(src, m.start())
            # Fold in whatever builds this call's params, one hop — a builder
            # function by name, and any type the enclosing signature declares.
            # A PARAMETER's type — `(params: DisposalFilters = {})` — not every
            # capitalised word after a colon. The wide version folded in
            # `apiGet<CustomerReservation[]>`'s own type and, through it, enough
            # unrelated text to mention a page: the detector stopped detecting,
            # and the mutation that proves this check works slipped straight
            # through it. Widen a resolver far enough and it answers yes to
            # everything.
            for name in BUILDS_PARAMS.findall(window) + re.findall(r"\(\s*\w+\s*:\s*([A-Z]\w+)", window):
                window += "\n" + builders.get(name, "")
            here = str(f.relative_to(PANEL))
            if here in A_SUMMARY_WITH_THE_REST_ELSEWHERE:
                continue
            if not (ASKS_FOR_A_PAGE.search(window)
                    or ASKS_BY_NAME_TOO.search(window)
                    or DRAINS_EVERY_PAGE.search(window)):
                stuck.append((m.group(1).lstrip("/"), here))

    return stuck, judged


# ── A page argument nobody supplies ─────────────────────────────────────
#
# The third shape, and the one the other two both miss.
#
# `useMyOrders(page = 1)` sent the page, kept previous data, and had done since
# it was written. `MyOrdersPage` called it as `useMyOrders()` and rendered no
# pager — so a buyer who had ordered sixteen times could never look at the
# first one. The call CAN vary, so the per-list check above is satisfied; the
# folder holds a pager on a different screen, so the folder check is satisfied
# too. Built, tested, and wired to nothing.
#
# The signature is the giveaway: a hook that offers a page and is never once
# asked for a second one.
TAKES_A_PAGE = re.compile(r"export function (use\w+)\(([^)]*)\)")


def page_argument_nobody_passes(blind: bool = False) -> tuple[list[tuple[str, str]], int]:
    """
    (hook, where it is declared) for hooks whose page argument no caller sends,
    and HOW MANY were examined.

    The count is not decoration. The first version of this function read

        if ".test." in f.name is False

    which Python parses as a chained comparison — `(".test." in f.name) and
    (f.name is False)` — so it is always False and the source list was EMPTY. It
    printed "0 hooks offer a page nobody asks for" and looked exactly like a
    clean result, including against the mutation planted to prove it works. A
    detector that reads nothing reports no problems; only a denominator tells
    the two apart, which is the rule this whole file is built on and which I
    still managed to break inside it.
    """
    files = [] if blind else [f for f in
             list((PANEL / "src").rglob("*.ts")) + list((PANEL / "src").rglob("*.tsx"))
             if ".test." not in f.name]
    sources = [(f, f.read_text()) for f in files]
    everything = "\n".join(src for _f, src in sources)

    out, judged = [], 0
    for f, src in sources:
        for m in TAKES_A_PAGE.finditer(src):
            hook, params = m.group(1), m.group(2)
            if "page" not in params:
                continue
            judged += 1
            # Every CALL of it — the declaration excluded by what precedes it,
            # not by what it contains. Excluding any argument list containing an
            # `=` was the first attempt and it threw away real callers:
            # `useDayHistory(listParams, tab === "history")` has three of them,
            # so two working screens were reported as never passing a page.
            # Two false positives out of three findings, and only reading them
            # one by one told me which.
            calls = [m for m in re.finditer(rf"(?<!function )\b{re.escape(hook)}\(([^)]*)\)", everything)]
            if not [m for m in calls if m.group(1).strip()]:
                out.append((hook, str(f.relative_to(PANEL))))

    return out, judged


def _mobile_calls(route: str) -> bool:
    """
    Does the phone app fetch this route?

    Read the same way the panel is read — by SHAPE, so `${slug}` and `{slug}`
    are the same path — because comparing them as characters is what made two
    live routes look unnamed the first time round.
    """
    if not MOBILE.exists():
        return False

    src_dir = MOBILE / "src"
    if not src_dir.exists():
        return False

    for f in list(src_dir.rglob("*.ts")) + list(src_dir.rglob("*.tsx")):
        if ".test." in f.name:
            continue
        src = f.read_text(errors="ignore")
        for call in re.findall(r'["\'`](/[a-z][\w\-/${}]*)["\'`]', src):
            if _same_shape(call, route):
                return True

    return False


def _same_shape(call: str, route: str) -> bool:
    """One path equals another with `${x}` and `{x}` both reading as a wildcard."""
    def shape(p: str) -> tuple[str, ...]:
        return tuple("*" if ("$" in seg or seg.startswith("{")) else seg
                     for seg in p.strip("/").split("/"))

    a, b = shape(call), shape(route)

    return len(a) == len(b) and all(x == "*" or y == "*" or x == y for x, y in zip(a, b))


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
        #
        # Exact by SHAPE, though, not by characters. A screen writes
        # `/marketplace/shops/${slug}/products` and Laravel writes
        # `marketplace/shops/{slug}/products`; compared as strings they never
        # matched, so two routes that ARE fetched — by a screen that pages them
        # correctly — were reported as named by no screen at all. The report
        # says out loud that a route nobody names is either an unbuilt list or a
        # path this scan failed to recognise; those two were the second, and
        # saying so was not the same as fixing it.
        lists = sorted({r for r in routes for c in calls if _same_shape(c, r)})
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

    # THE OTHER DENOMINATOR. A paginating route no PANEL screen names is one of
    # three things, and they look identical from here: a list nobody built yet,
    # a path this scan failed to recognise, or a route another client uses. The
    # third one has bitten: `marketplace/shops/{slug}/products` stopped being
    # called by the panel the day the aisle replaced it, and the phone app had
    # been calling it the whole time.
    #
    # So the phone is searched before anything is called quiet, and a route it
    # uses is reported under its own heading rather than as an absence.
    quiet = sorted(routes - listed)
    # Blinded means blinded on EVERY input. Reading the phone while the panel is
    # blindfolded would place one route and break the identity `prove()` rests
    # on — that a scan reading nothing can place nothing.
    on_the_phone = set() if mutate == "blind" else {q for q in quiet if _mobile_calls(q)}
    quiet = [q for q in quiet if q not in on_the_phone]

    if on_the_phone:
        print(f"\n{len(on_the_phone)} paginating route(s) the panel no longer names, but the phone app does:")
        for q in sorted(on_the_phone):
            print(f"  · {q}")
        print("  Not dead. Deleting one of these breaks the app, and this scan reads the panel only.")

    print(f"\n{len(quiet)} of {len(routes)} paginating routes are named by no screen:")
    for q in quiet:
        print(f"  · {q}")

    # ── per LIST, not per folder ───────────────────────────────────────
    frozen, judged = frozen_on_page_one(set() if mutate == "blind" else routes)
    print(f"\n{len(frozen)} of {judged} literal calls to a paginating route cannot "
          f"ask for anything but page one:")
    for route, where in frozen:
        print(f"  · {route:32} {where}")

    # Blinded by INPUT, not by being skipped. A check that is stepped over in
    # the proving run cannot be told apart from one that is broken — which is
    # the exact confusion the proving run exists to end.
    orphans, hooks = page_argument_nobody_passes(blind=mutate == "blind")
    print(f"\n{len(orphans)} of {hooks} hook(s) that offer a page are never asked for one:")
    for hook, where in orphans:
        print(f"  · {hook:32} {where}")

    return (len(stuck) + len(frozen) + len(orphans), checked, len(quiet), len(routes),
            judged, hooks)


def prove() -> int:
    """
    Blind the detector and require the result to LOOK blind.

    A scan that reads nothing reports "0 problems", which is character for
    character what a clean sweep reports. The only thing that tells them apart
    is the denominator — so this run asserts on the denominator and never on
    the verdict.
    """
    print("── proving it can fail ──\n")
    _, checked, quiet, routes, calls, hooks = report(mutate="blind")

    if checked != 0 or quiet != routes or calls != 0 or hooks != 0:
        print("\nBROKEN: a detector reading nothing still found things to judge "
              f"(folders={checked}, calls={calls}, hooks={hooks})")
        return 1

    print(f"\nblinded: checked 0 folders, 0 calls and 0 hooks, and could place "
          f"none of {routes} routes.")
    print("That is the shape a broken scan takes. A real run below that checks 0")
    print("is broken too, whatever its verdict says.\n")

    stuck, checked, quiet, routes, calls, hooks = report()

    if checked == 0 or calls == 0 or hooks == 0:
        print("\nBROKEN: the real run judged nothing either "
              f"(folders={checked}, calls={calls}, hooks={hooks})")
        return 1

    return 1 if stuck else 0


if __name__ == "__main__":
    if "--prove" in sys.argv:
        raise SystemExit(prove())

    stuck, checked, _quiet, _routes, calls, hooks = report()
    raise SystemExit(1 if (stuck or checked == 0 or calls == 0 or hooks == 0) else 0)
