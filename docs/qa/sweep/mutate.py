#!/usr/bin/env python3
"""
Does the sweep have teeth?

A clean run is worthless on its own. "126 ok, 0 bugs" is indistinguishable from
"126 checks that cannot fail", and this codebase has already shipped three
guards that passed while blind to their own subject. So before believing a
green sweep, BREAK it on purpose and watch it complain.

Each mutation below lies to the sweep — not to the server — about one thing,
and names the finding that must appear. A mutation that stays silent is a check
that was never checking.

    python3 mutate.py
"""

import os
import sys

# See the note in run.py: imported by bare name, so it must run from here.
os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.getcwd())

import api as api_mod  # noqa: E402
import phase_a
import phase_b
import phase_c
import phase_d
import phase_e
import phase_f
import phase_g
import phase_h
import phase_i
import phase_j
import phase_k
import phase_l
import phase_m
import phase_n
from api import Api, Report


def mutation(name: str, must_report: str, apply, undo, ran_marker: str,
             phases: tuple = ("c", "d", "e")) -> bool:
    """
    Break one thing, and require the sweep to notice.

    `ran_marker` is the part that took a wrong answer to learn. Without it this
    harness cannot tell "the check stayed silent" from "the check never
    executed" — and the first time it mattered, a phase died on a 429 and this
    function printed THE CHECK IS BLIND about a check that was working. A
    detector with no denominator, in the tool built to catch exactly that.

    So a mutation now has three verdicts, not two, and the third is honest:

        CAUGHT        the sweep reported the finding
        MISSED        the check ran and said nothing  ← a real hole
        INCONCLUSIVE  the check never got to run      ← fix the run, not the code
    """
    api, rep = Api(), Report()
    rep.rows = []

    # Only one trade — a mutation proves the check is live, not that it is live
    # eight times.
    tenants = phase_a.run(api, rep)
    if not tenants:
        print("  cannot run: phase A gave nothing")
        return False

    # Phase F needs two shops to have a wall between; the rest need one.
    picked = ["retail", "mart"] if "f" in phases else ["retail"]
    if "g" in phases:
        picked = [c for c in ("pharmacy", "petroleum", "food_restaurant") if c in tenants]
    if "i" in phases or "j" in phases or "k" in phases or "m" in phases:
        picked = ["mart"]
    if "n" in phases:
        picked = ["retail"]
    if "l" in phases:
        picked = ["food_restaurant"]
    shops = phase_b.run(api, rep, {c: tenants[c] for c in picked if c in tenants})

    apply()
    try:
        before = len(rep.rows)
        sold = phase_c.run(api, rep, shops)
        if "d" in phases:
            phase_d.run(api, rep, sold)
        if "e" in phases:
            phase_e.run(api, rep, sold)
        if "f" in phases:
            api.token = api.login(phase_a.ADMIN)
            phase_f.run(api, rep, sold, tenants)
        if "g" in phases:
            phase_g.run(api, rep, sold)
        if "h" in phases:
            phase_h.run(api, rep, sold)
        if "i" in phases:
            api.token = api.login(phase_a.ADMIN)
            phase_i.run(api, rep, sold, tenants)
        if "j" in phases:
            phase_j.run(api, rep, sold)
        if "k" in phases:
            phase_k.run(api, rep, sold)
        if "l" in phases:
            phase_l.run(api, rep, sold)
        if "m" in phases:
            phase_m.run(api, rep, sold)
        if "n" in phases:
            phase_n.run(api, rep, sold)
        window = rep.rows[before:]
    finally:
        undo()

    found = [r for r in window if r[0] == "BUG" and must_report in r[2]]
    reached = [r for r in window if ran_marker in r[2]]

    if found:
        verdict, note = "CAUGHT ", ""
    elif not reached:
        verdict, note = "UNCLEAR", f"  ← the check never ran (looked for {ran_marker!r})"
    else:
        verdict, note = "MISSED ", "  ← THE CHECK IS BLIND"

    print(f"\n  {verdict} {name}  → expected a BUG naming {must_report!r}{note}\n")
    return bool(found)


def main() -> int:
    results = []

    # 1 · the shelf. Lie about the stock reading so it never moves. If the
    #     sweep still says "sale took 3 off the shelf", it is reading nothing.
    #
    #     The shelf is filled FIRST, for real. Freezing the reading also blinds
    #     the sweep's own restock — which reads the same figure — so without
    #     this the phase rang into an empty shelf and the stock check never got
    #     to run at all. The harness said UNCLEAR rather than MISSED, which is
    #     exactly what the third verdict is for: it named a broken mutation
    #     instead of accusing a working check.
    real_stock = phase_c._stock_of
    results.append(mutation(
        "stock never moves",
        "TAKES STOCK OFF THE SHELF",
        lambda: (_fill_the_shelf(), setattr(phase_c, "_stock_of", lambda *a, **k: 100.0)),
        lambda: setattr(phase_c, "_stock_of", real_stock),
        ran_marker="TAKES STOCK OFF THE SHELF",
    ))

    # 2 · the price. Tell the sweep the product costs twice what it does. The
    #     server will charge the real figure, and the sweep must object —
    #     otherwise its "client price ignored" line proves nothing.
    real_price = phase_c.PRICE
    results.append(mutation(
        "expected price doubled",
        "SERVER PRICES THE SALE",
        lambda: setattr(phase_c, "PRICE", real_price * 2),
        lambda: setattr(phase_c, "PRICE", real_price),
        ran_marker="PRICES THE SALE",
    ))

    # 3 · the drawer. Swallow every non-2xx so a refused void reads as accepted.
    #     The double-void guard must then fire on the second cancel.
    real_post = Api.post
    results.append(mutation(
        "every refusal reads as success",
        "VOIDED TWICE",
        lambda: setattr(Api, "post", lambda self, p, b=None, **k: _pretend_ok(real_post, self, p, b, **k)),
        lambda: setattr(Api, "post", real_post),
        ran_marker="void",
    ))

    # 4 · the cost. Freeze the cost reading so it never moves, while goods
    #     arrive at a price the product does not currently carry. Blended,
    #     last-price and unchanged all differ here, so a frozen reading has to
    #     be caught.
    #
    #     The first version of this mutation received AT the cost already held —
    #     under which a blended figure and an unchanged one are the same number,
    #     so nothing could possibly be detected. A mutation that cannot fail is
    #     the same mistake as a check that cannot fail, one level up.
    real_cost = phase_d._cost
    results.append(mutation(
        "cost never moves",
        "RECEIVE DID NOT MOVE THE COST",
        lambda: setattr(phase_d, "_cost", lambda *a, **k: 300.0),
        lambda: setattr(phase_d, "_cost", real_cost),
        ran_marker="cost",
    ))

    # 5 · the ledger. Strip every reference_type out of the movement history.
    #     "39 movements" would still print; only the traceability check should
    #     notice, which is the whole reason it is separate from the count.
    real_rows = phase_d._rows
    results.append(mutation(
        "movements lose their cause",
        "TRACEABLE MOVEMENT",
        lambda: setattr(phase_d, "_rows", lambda b: [
            {k: v for k, v in r.items() if k != "reference_type"} for r in real_rows(b)
        ]),
        lambda: setattr(phase_d, "_rows", real_rows),
        ran_marker="movements",
    ))

    # 6 · the profit line. Freeze net_profit so it never moves, and the report
    #     stops agreeing with its own components. This is the shape of a bug
    #     that has already shipped here once — recorded income missing from
    #     profit — and it is the perfect silent failure: nothing errors, no
    #     screen is blank, the number is simply lower than the truth for ever.
    real_totals = phase_e._totals
    results.append(mutation(
        "net profit never moves",
        "INCOME REACHES NET PROFIT",
        lambda: setattr(phase_e, "_totals", lambda a, t, path: _frozen(real_totals(a, t, path))),
        lambda: setattr(phase_e, "_totals", real_totals),
        ran_marker="net profit",
    ))

    # 7 · the khata. Freeze the customer balance. Goods go out on credit and the
    #     ledger says the customer owes nothing — a shop giving away stock and
    #     being told it is square.
    real_balance = phase_e._balance
    results.append(mutation(
        "khata balance never moves",
        "CREDIT SALE LANDS ON THE KHATA",
        lambda: setattr(phase_e, "_balance", lambda *a, **k: 0.0),
        lambda: setattr(phase_e, "_balance", real_balance),
        ran_marker="khata",
    ))

    # 8 · the wall between shops. Make every refusal read as success and the
    #     isolation checks must all fire at once. This is the only failure in a
    #     multi-tenant system that ends the company, so its check gets the
    #     harshest possible mutation: nothing is refused at all.
    real_get, real_post = Api.get, Api.post
    results.append(mutation(
        "no request is ever refused",
        "CANNOT SELL",
        lambda: (setattr(Api, "get", _always_ok(real_get)),
                 setattr(Api, "post", _always_ok(real_post))),
        lambda: (setattr(Api, "get", real_get), setattr(Api, "post", real_post)),
        ran_marker="cannot read",
        phases=("f",),
    ))

    # 9 · FEFO. Report the far-dated lot as the one that moved. A pharmacy that
    #     ships the wrong lot leaves the expired strip on the shelf until
    #     somebody takes it home, and nothing anywhere errors.
    real_batches = phase_g._batches
    results.append(mutation(
        "the wrong lot appears to move",
        "EARLIEST EXPIRY FIRST",
        lambda: setattr(phase_g, "_batches", _far_lot_moves()),
        lambda: setattr(phase_g, "_batches", real_batches),
        ran_marker="lot",
        phases=("g",),
    ))

    # 10 · the offline price. The till's own arithmetic is the one thing a
    #      synced sale must never keep — otherwise "offline mode" is a
    #      documented way to pay whatever you like.
    real_fetch = phase_h._fetch
    results.append(mutation(
        "the synced sale keeps the till's price",
        "RE-PRICED BY THE SERVER",
        lambda: setattr(phase_h, "_fetch", lambda *a, **k: {"total": 2, "tax": 0}),
        lambda: setattr(phase_h, "_fetch", real_fetch),
        ran_marker="offline sale",
        phases=("h",),
    ))

    # 11 · the lanes. Show every till the same figure. Three cashiers who each
    #      took a different amount would all be counted against one number, and
    #      two of the three are short or over through no fault of their own.
    real_expected = phase_i._expected
    results.append(mutation(
        "every lane reads the same drawer",
        "HOLDS ONLY ITS OWN TAKINGS",
        lambda: setattr(phase_i, "_expected", lambda report: 1500.0),
        lambda: setattr(phase_i, "_expected", real_expected),
        ran_marker="drawer",
        phases=("i",),
    ))

    # 12 · the wire between the books and the till. Freeze the drawer figure so
    #      a cash bill appears to take nothing out of it — the exact failure the
    #      Expense Manager's drawer link exists to prevent, where the cashier is
    #      short by the electricity bill and nothing on the shift says why.
    real_j_expected = phase_j._expected
    results.append(mutation(
        "the drawer never notices the money leave",
        "CASH BILL LEAVES THE DRAWER",
        lambda: setattr(phase_j, "_expected", lambda api, token: 5000.0),
        lambda: setattr(phase_j, "_expected", real_j_expected),
        ran_marker="drawer",
        phases=("j",),
    ))

    # 13 · the branches. Freeze the per-branch reading so a transfer appears to
    #      arrive without ever leaving — the shop then believes it owns twice
    #      what it has, until somebody counts.
    real_stock_at = phase_k._stock_at
    results.append(mutation(
        "the source shelf never moves",
        "TRANSFER DEPLETES THE SOURCE",
        lambda: setattr(phase_k, "_stock_at", _one_shelf_frozen(real_stock_at)),
        lambda: setattr(phase_k, "_stock_at", real_stock_at),
        ran_marker="transfer",
        phases=("k",),
    ))

    # 14 · the floor. Make a partial settlement look like it took nothing, so
    #      a table that paid for two plates of five appears to still owe all
    #      five — or, the way it fails in the world, appears to owe none.
    #      The first version patched `_rows`, which the split check does not
    #      use — it reads the ticket's `items` directly. The lie never reached
    #      the check, which then passed on real data and was reported as blind.
    #      A mutation aimed at the wrong reader proves nothing.
    real_split_of = phase_l._split_of
    results.append(mutation(
        "a split settles nothing",
        "A SPLIT LEAVES THE REST OWING",
        lambda: setattr(phase_l, "_split_of", lambda lines: (0.0, 5.0)),
        lambda: setattr(phase_l, "_split_of", real_split_of),
        ran_marker="split",
        phases=("l",),
    ))

    # 15 · the points. Freeze the balance so redeeming appears to cost nothing.
    #      Points are money the shop owes; spending that never lands means the
    #      same points buy goods again tomorrow, for ever.
    real_points = phase_m._points
    results.append(mutation(
        "the points balance never moves",
        "POINTS ARE EARNED AT THE SHOP",
        lambda: setattr(phase_m, "_points", lambda *a, **k: 25),
        lambda: setattr(phase_m, "_points", real_points),
        ran_marker="points",
        phases=("m",),
    ))

    # 16 · the advance. Freeze the drawer figure so a layaway deposit appears
    #      to reach nothing. Real cash is handed over and the till never hears:
    #      the shift closes OVER by exactly the advance, every time, and the
    #      cashier is the one asked to explain it.
    real_n_expected = phase_n._expected
    results.append(mutation(
        "an advance never reaches the drawer",
        "AN ADVANCE IS CASH IN THE DRAWER",
        lambda: setattr(phase_n, "_expected", lambda api, token: 3000.0),
        lambda: setattr(phase_n, "_expected", real_n_expected),
        ran_marker="advance",
        phases=("n",),
    ))

    # 17 · the exchange. Freeze the shelf so goods can go out without coming
    #      back. Half an exchange looks like a completed one on the receipt and
    #      is only ever visible on the shelf.
    real_n_stock = phase_n._stock
    results.append(mutation(
        "only half the exchange happens",
        "AN EXCHANGE DOES BOTH HALVES",
        lambda: setattr(phase_n, "_stock", _drifting(real_n_stock)),
        lambda: setattr(phase_n, "_stock", real_n_stock),
        ran_marker="exchange",
        phases=("n",),
    ))

    print("=" * 70)
    print(f"{sum(results)} of {len(results)} mutations caught")
    print("=" * 70)
    return 0 if all(results) else 1


def _fill_the_shelf() -> None:
    """A real restock, through the endpoint that actually moves stock."""
    api = Api()
    token = api.login("sweep-retail@qa.test")
    _, body = api.get("/products?search=Sweep+Item", token=token)
    rows = body.get("data") or []
    rows = rows if isinstance(rows, list) else rows.get("data", [])
    for r in rows:
        api.post("/inventory/adjust", {
            "product_id": r["id"], "type": "set",
            "new_quantity": 100, "reason": "mutation setup",
        }, token=token)


def _drifting(real):
    """Real, then one short — a shelf that lost a unit it should not have."""
    seen = {"n": 0}

    def stock(api, token, pid):
        seen["n"] += 1
        value = real(api, token, pid)
        return value if value is None or seen["n"] == 1 else value - 1
    return stock


def _one_shelf_frozen(real):
    """Real everywhere except the source branch, which never moves."""
    seen = {}

    def stock_at(api, token, pid, branch_id):
        value = real(api, token, pid, branch_id)
        first = seen.setdefault(branch_id, value)
        # The FIRST branch asked about is the transfer's source.
        return first if branch_id == next(iter(seen)) else value
    return stock_at


def _always_ok(real):
    """Every 4xx reads as a 200 — the wall reported as no wall at all."""
    def call(self, path, *a, **kw):
        status, payload = real(self, path, *a, **kw)
        return (200, payload) if status >= 400 else (status, payload)
    return call


def _far_lot_moves():
    """First read: both lots full. Second: the FAR one shrank — the exact
    inversion of first-expiry-first-out."""
    seen = {"n": 0}

    def batches(api, token, pid):
        seen["n"] += 1
        return ({"SWEEP-NEAR": 10.0, "SWEEP-FAR": 10.0} if seen["n"] == 1
                else {"SWEEP-NEAR": 10.0, "SWEEP-FAR": 9.0})
    return batches


def _frozen(totals: dict) -> dict:
    """Real figures, except the one the report is judged on."""
    return {**totals, "net_profit": 1_000_000.0} if totals else totals


def _pretend_ok(real_post, self, path, body, **kw):
    status, payload = real_post(self, path, body, **kw)
    if path.endswith("/cancel") and status >= 400:
        return 200, payload
    return status, payload


if __name__ == "__main__":
    raise SystemExit(main())
