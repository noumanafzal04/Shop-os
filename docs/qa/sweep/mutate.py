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
import phase_o
import phase_p
import phase_q
import phase_r
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
    if "n" in phases or "o" in phases or "p" in phases:
        picked = ["retail"]
    # Phase Q's sharpest checks are a forecourt's, so petroleum has to be one of
    # them. An earlier edit left the previous branch's `picked = ["retail"]`
    # dangling INSIDE this one, overwriting the line above it — so the fuel
    # mutations ran against a shop with no tanks and came back UNCLEAR twice.
    if "q" in phases:
        picked = [c for c in ("petroleum", "retail") if c in tenants]
    if "l" in phases:
        picked = ["food_restaurant"]
    # Phase R needs a shop the marketplace will show — only the mart is listed —
    # AND a second shop whose product it can try to smuggle into an order. With
    # one shop the cross-tenant check has nothing to borrow and quietly does not
    # run, which is how the most valuable question in the phase came back
    # UNCLEAR the first time it was asked.
    if "r" in phases:
        picked = [c for c in ("mart", "retail") if c in tenants]
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
        # Phase Q's fuel checks need a forecourt, and phase G is what builds
        # one. Without it `/fuel/tanks` is empty, the delivery check reports
        # "no tank to deliver into" and quietly stops — which this harness then
        # correctly called UNCLEAR rather than caught. A mutation aimed at a
        # check that never runs proves nothing about the check.
        if "g" in phases or "q" in phases:
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
        if "o" in phases:
            phase_o.run(api, rep, sold)
        if "p" in phases:
            phase_p.run(api, rep, sold)
        if "q" in phases:
            phase_q.run(api, rep, sold)
        if "r" in phases:
            phase_r.run(api, rep, sold)
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

    # 18 · a job the shop cannot do. Report every preset's screens as reachable
    #      and the offered-job check must fire: the whole point of it is that a
    #      MODULE_DISABLED answer is not a permission problem but IS a sign the
    #      job should never have been on the list.
    #
    #      This is the mutation that matters most for that check, because the
    #      check's own first version was blind — it read a module 403 as a
    #      permission failure and accused the preset of eleven bugs it had not
    #      committed, on two shops nobody had ever run it against.
    #      So the mutation switches the buyer's own screens OFF at a shop that
    #      HAS the inventory module: a mart offered a Purchasing job whose
    #      suppliers and purchase orders both answer MODULE_DISABLED. That is
    #      precisely the state a restaurant was in, and the check must say so
    #      rather than shrug at a 403 it has been taught to forgive.
    real_get = Api.get
    results.append(mutation(
        "a job's own screens are switched off under it",
        "A JOB OFFERED MUST BE A JOB THAT CAN BE DONE",
        lambda: setattr(Api, "get", _module_off_for(real_get, ("/suppliers", "/purchase-orders"))),
        lambda: setattr(Api, "get", real_get),
        ran_marker="is off for this shop",
        phases=("i",),
    ))

    # 19 · the parked ticket that sells itself. A held ticket is a note under
    #      the till, not a sale — if parking one moved stock, a shop that parks
    #      ten tickets across a Saturday would refuse to sell goods it has, all
    #      day, without a single error.
    real_on_hand = phase_o.on_hand
    results.append(mutation(
        "parking a ticket takes the stock",
        "A PARKED TICKET HOLDS NOTHING",
        lambda: setattr(phase_o, "on_hand", _shrinks_after_first(real_on_hand)),
        lambda: setattr(phase_o, "on_hand", real_on_hand),
        ran_marker="ticket parked",
        phases=("o",),
    ))

    # 20 · one basket, two bills. The worst thing that can happen at a counter
    #      with more than one lane: two cashiers open the held list in the same
    #      second, both load the same cart, both take money, and the stock
    #      leaves twice. `claim` is atomic precisely to stop it.
    real_post = Api.post
    results.append(mutation(
        "every lane can resume the same ticket",
        "ONE BASKET CANNOT BE RESUMED TWICE",
        lambda: setattr(Api, "post", _claims_always_succeed(real_post)),
        lambda: setattr(Api, "post", real_post),
        ran_marker="first lane got the basket",
        phases=("o",),
    ))

    # 21 · the order that promises what it has not kept. No hold and two
    #      customers are told the last packet is theirs; one of them is standing
    #      at a door for nothing.
    real_on_hand_2 = phase_o.on_hand
    results.append(mutation(
        "an order never holds its stock",
        "AN ORDER HOLDS ITS STOCK",
        lambda: setattr(phase_o, "on_hand", _never_moves(real_on_hand_2)),
        lambda: setattr(phase_o, "on_hand", real_on_hand_2),
        ran_marker="caller's price ignored",
        phases=("o",),
    ))

    # 22 · the money banked against the wrong day. The bug this phase was
    #      written to find, put back on purpose: with last night's day still
    #      open, today's takings land on yesterday and today's banking column
    #      never moves.
    real_post_dep = Api.post
    results.append(mutation(
        "a deposit lands on some other open day",
        "A DEPOSIT BELONGS TO THE DAY THE SHOP IS TRADING",
        lambda: setattr(Api, "post", _deposit_drifts(real_post_dep)),
        lambda: setattr(Api, "post", real_post_dep),
        ran_marker="day(s) open at the counter",
        phases=("p",),
    ))

    # 23 · the day that does not add up. Three lanes counted separately must
    #      total one figure; if they do not, the shop reconciles a number that
    #      never existed and the difference is somebody's shortfall.
    real_post_day = Api.post
    results.append(mutation(
        "the day's takings do not match its shifts",
        "THE DAY IS THE SUM OF ITS SHIFTS",
        lambda: setattr(Api, "post", _day_total_drifts(real_post_day)),
        lambda: setattr(Api, "post", real_post_day),
        ran_marker="day closed",
        phases=("p",),
    ))

    # 24 · the receipt that never leaves the tray. A tray that never empties
    #      buries the one receipt that really is missing under fifty that were
    #      sorted out hours ago — which is the same as having no tray.
    real_get_tray = Api.get
    results.append(mutation(
        "the tray keeps a receipt that printed",
        "A REPRINTED RECEIPT LEAVES THE TRAY",
        lambda: setattr(Api, "get", _tray_never_empties(real_get_tray)),
        lambda: setattr(Api, "get", real_get_tray),
        ran_marker="failed receipt is in the reprint tray",
        phases=("q",),
    ))

    # 25 · the tanker that was billed for more than it delivered. Booking the
    #      INVOICE into the tank leaves a station counting fuel that was never
    #      in the ground, and finding out weeks later as an unexplained loss.
    real_get_tank = Api.get
    results.append(mutation(
        "the tank counts the invoice, not the dip",
        "THE TANK GAINS WHAT ARRIVED, NOT WHAT WAS BILLED",
        lambda: setattr(Api, "get", _tank_counts_the_invoice(real_get_tank)),
        lambda: setattr(Api, "get", real_get_tank),
        ran_marker="shortage recorded",
        phases=("q",),
    ))

    # 26 · tomorrow's rate on tonight's petrol. The bug this phase found, put
    #      back: a station enters the notification at 8pm and sells the whole
    #      night at a rate that does not start until midnight.
    real_post_rate = Api.post
    results.append(mutation(
        "a future rate prices a sale made now",
        "A RATE THAT HAS NOT STARTED DOES NOT PRICE ANYTHING",
        lambda: setattr(Api, "post", _sale_takes_tomorrows_rate(real_post_rate)),
        lambda: setattr(Api, "post", real_post_rate),
        ran_marker="tomorrow's rate logged",
        phases=("q",),
    ))

    # ── Phase R · the customer ────────────────────────────────────────────
    #
    # 25 · the wall between shops. `shop_slug` and the product ids arrive in one
    #      body with nothing tying them together, so this is the one request a
    #      customer could use to make a shop hand over goods it does not stock.
    #      Pretend every order was accepted and the sweep must object.
    real_post_r = Api.post
    results.append(mutation(
        "an order into another shop is accepted",
        "AN ORDER REACHED INTO ANOTHER SHOP",
        lambda: setattr(Api, "post", lambda self, p, b=None, **k: _customer_order_accepted(real_post_r, self, p, b, **k)),
        lambda: setattr(Api, "post", real_post_r),
        ran_marker="an order cannot reach across shops",
        phases=("r",),
    ))

    # 26 · whose order is it. Answer 200 to any customer asking for any order.
    #      A sweep that shrugged at that would be reporting "another customer
    #      cannot read this order" about a check that cannot tell.
    real_get_r = Api.get
    results.append(mutation(
        "any customer may read any order",
        "ANOTHER CUSTOMER READ THIS ORDER",
        lambda: setattr(Api, "get", lambda self, p, **k: _customer_reads_anything(real_get_r, self, p, **k)),
        lambda: setattr(Api, "get", real_get_r),
        ran_marker="another customer cannot read this order",
        phases=("r",),
    ))

    print("=" * 70)
    print(f"{sum(results)} of {len(results)} mutations caught")
    print("=" * 70)
    return 0 if all(results) else 1


def _module_off_for(real, paths: tuple[str, ...]):
    """Answer MODULE_DISABLED on these routes, as a shop without the module would."""
    def faked(self, p, **kw):
        if any(p == path or p.startswith(path + "?") for path in paths):
            return 403, {"message": "This module is not enabled for your shop.",
                         "meta": {"error_code": "MODULE_DISABLED"}}
        return real(self, p, **kw)
    return faked


def _tray_never_empties(real):
    """The reprint tray keeps reporting a receipt that has already come out."""
    kept = {"rows": None}

    def call(self, p, **kw):
        status, payload = real(self, p, **kw)
        if p == "/receipts/pending" and status < 400:
            rows = payload.get("data") or []
            if rows:
                kept["rows"] = rows          # remember it while it is owed
            elif kept["rows"] is not None:
                payload["data"] = kept["rows"]   # and never let go
        return status, payload
    return call


def _tank_counts_the_invoice(real):
    """
    After a delivery, report the tank holding the INVOICED litres.

    The first version of this mutation only WATCHED the delivery go past and
    changed nothing, so the check passed and the harness called it caught —
    a mutation that does not mutate proves the opposite of what it claims.
    """
    state = {"reads": 0}
    short = 50.0   # phase Q bills 5000 and dips 4950

    def call(self, p, **kw):
        status, payload = real(self, p, **kw)
        if p == "/fuel/tanks" and status < 400:
            state["reads"] += 1
            # The first read is the "before"; every read after the delivery is
            # inflated to what the supplier billed for.
            if state["reads"] > 1:
                rows = payload.get("data") or []
                rows = rows if isinstance(rows, list) else rows.get("data", [])
                for t in rows:
                    if t.get("current_dip_litres") is not None:
                        t["current_dip_litres"] = float(t["current_dip_litres"]) + short
        return status, payload
    return call


def _sale_takes_tomorrows_rate(real):
    """Price the sale at the rate that has not started yet."""
    pending = {"price": None}

    def call(self, p, body=None, **kw):
        if p == "/fuel/prices" and body:
            pending["price"] = float(body.get("new_price") or 0)
        status, payload = real(self, p, body, **kw)
        if p == "/sales" and status < 400 and pending["price"]:
            for line in (payload.get("data") or {}).get("items") or []:
                line["unit_price"] = pending["price"]
        return status, payload
    return call


def _deposit_drifts(real):
    """Bank it against a different day — the shop that forgot to close."""
    def call(self, path, body=None, **kw):
        status, payload = real(self, path, body, **kw)
        if path == "/pos/deposits" and status < 400:
            data = payload.setdefault("data", {})
            data["business_day_id"] = "01a00000-0000-7000-8000-000000000000"
        return status, payload
    return call


def _day_total_drifts(real):
    """The day closes carrying a cash figure its shifts never took."""
    def call(self, path, body=None, **kw):
        status, payload = real(self, path, body, **kw)
        if path.endswith("/close") and "/days/" in path and status < 400:
            data = payload.setdefault("data", {})
            data["cash_sales"] = round(float(data.get("cash_sales") or 0) + 250, 2)
        return status, payload
    return call


def _shrinks_after_first(real):
    """First read real; every read after it is short — a shelf that moved when
    nothing was sold."""
    seen = {"n": 0}

    def stock(api, token, pid):
        seen["n"] += 1
        value = real(api, token, pid)
        return value if value is None or seen["n"] == 1 else value - 3
    return stock


def _never_moves(real):
    """Every read returns the FIRST figure — a shelf that notices nothing."""
    first = {}

    def stock(api, token, pid):
        value = real(api, token, pid)
        return first.setdefault(pid, value)
    return stock


def _claims_always_succeed(real):
    """A claim never refuses — every lane gets the same basket."""
    def call(self, path, body=None, **kw):
        status, payload = real(self, path, body, **kw)
        if path.endswith("/claim") and status >= 400:
            return 200, {"data": {"cart": {"items": [{"product_id": "x", "quantity": 1}]}}}
        return status, payload
    return call


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


def _customer_order_accepted(real_post, self, path, body, **kw):
    """Every attempt to PLACE an order comes back accepted, whatever happened."""
    status, payload = real_post(self, path, body, **kw)

    if path == "/customer/orders" and status >= 400:
        return 201, {"data": {"id": "mutant-order", "total": 0.01}}

    return status, payload


def _customer_reads_anything(real_get, self, path, **kw):
    """Every customer-side read succeeds — including one that is not yours."""
    status, payload = real_get(self, path, **kw)

    if path.startswith("/customer/orders/") and status >= 400:
        return 200, {"data": {"id": path.rsplit("/", 1)[-1]}}

    return status, payload


def _pretend_ok(real_post, self, path, body, **kw):
    status, payload = real_post(self, path, body, **kw)
    if path.endswith("/cancel") and status >= 400:
        return 200, payload
    return status, payload


if __name__ == "__main__":
    raise SystemExit(main())
