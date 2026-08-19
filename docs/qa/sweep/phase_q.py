"""
Phase Q — the paper, the tanker and the workshop.

Three subjects nothing had ever driven, picked because each one is a place a
shop loses money without anything erroring.

    THE RECEIPT      A receipt that never came out is a customer still standing
                     at the counter. The till's reprint tray is the only thing
                     between that and an argument — and it is built on a
                     "no later successful print exists" subquery, which is
                     exactly the kind of clause that silently stops filtering.

    THE TANKER       A station is BILLED for what the invoice says and RECEIVES
                     what the dip says, and those are different numbers on most
                     deliveries. If stock went up by the invoiced figure, the
                     station would be counting fuel that was never in the
                     ground — and would find out weeks later, as a growing
                     unexplained loss.

    THE RATE         A price notification is the government changing what fuel
                     costs, usually at midnight. A rate logged before it applies
                     must not price today's sales, and a rate that has applied
                     must price every sale after it. Getting this wrong is
                     selling petrol at yesterday's price on the busiest morning
                     of the month.

Also here, because nobody had asked: the CSV a shop exports of its own catalog.
"""

import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

from api import Api, Report

DELIVERED = 5000.0     # what the invoice says
DIP_RISE = 4950.0      # what actually went in the ground


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code, state in sold.items():
        features = state.get("features") or {}
        token = state["token"]

        if features.get("pos"):
            _a_failed_receipt_waits_to_be_reprinted(api, rep, code, token, state)

        if features.get("fuel"):
            _a_delivery_counts_what_arrived_not_what_was_billed(api, rep, code, token)
            _a_rate_applies_when_it_says_it_does(api, rep, code, token, state)

        if features.get("products"):
            _the_shop_can_take_its_catalog_with_it(api, rep, code, token, state)

    return sold


# ── the receipt ────────────────────────────────────────────────────────

def _a_failed_receipt_waits_to_be_reprinted(api: Api, rep: Report, code: str,
                                            token: str, state: dict) -> None:
    """
    Print, say it failed, and it must be waiting in the tray. Print again
    successfully, and it must LEAVE.

    The tray is "every failed print with no later successful one for the same
    sale". Both halves matter and they fail in opposite directions: a tray that
    never fills lets a customer walk away with no receipt and no record of it,
    and a tray that never empties buries the one receipt that really is missing
    under fifty that were sorted out hours ago.
    """
    sale = state.get("stock_sale") or state.get("priced_sale") or {}
    sale_id = sale.get("id")
    if not sale_id:
        rep.query("Q", f"{code} · a sale to print", "none from phase C")
        return

    status, body = api.get(f"/sales/{sale_id}/invoice", token=token)
    if status != 200:
        rep.bug("Q", f"{code} · render a receipt", _why(status, body))
        return

    print_id = _latest_print(api, token, sale_id)
    if print_id is None:
        rep.bug("Q", f"{code} · RENDERING A RECEIPT LOGS THE PRINT",
                "the sale has no print trail after being rendered")
        return

    rep.ok("Q", f"{code} · receipt rendered and logged")

    # The till reports back that the paper never came out.
    status, body = api.post(f"/receipt-prints/{print_id}/outcome",
                            {"status": "failed", "error": "Sweep: out of paper"}, token=token)
    if status != 200:
        rep.bug("Q", f"{code} · report a failed print", _why(status, body))
        return

    if not _in_tray(api, token, sale_id):
        rep.bug("Q", f"{code} · A FAILED RECEIPT WAITS IN THE TRAY",
                "the till said the paper never came out and nothing is waiting — "
                "the customer leaves with no receipt and no record of it")
        return

    rep.ok("Q", f"{code} · failed receipt is in the reprint tray")

    # Print it again, and this time it comes out.
    api.get(f"/sales/{sale_id}/invoice", token=token)
    again = _latest_print(api, token, sale_id)
    if again is None or again == print_id:
        rep.query("Q", f"{code} · reprint is logged as its own print", str(again))
        return

    status, _ = api.post(f"/receipt-prints/{again}/outcome", {"status": "printed"}, token=token)
    if status != 200:
        rep.bug("Q", f"{code} · report a successful reprint", str(status))
        return

    if _in_tray(api, token, sale_id):
        rep.bug("Q", f"{code} · A REPRINTED RECEIPT LEAVES THE TRAY",
                "it printed, and the tray still says it is owed — the one receipt "
                "that really is missing gets buried under the ones that are not")
    else:
        rep.ok("Q", f"{code} · reprinted receipt left the tray")


def _latest_print(api: Api, token: str, sale_id: str) -> str | None:
    # The trail is `orderBy('copy_no')` — ASCENDING, so the first row is the
    # ORIGINAL and the last is the most recent copy. Reading row zero as "the
    # latest print" meant this check marked the original as failed, reprinted,
    # and then looked at the original again to see whether the reprint had
    # worked.
    status, body = api.get(f"/sales/{sale_id}/receipt-prints", token=token)
    rows = _rows(body) if status == 200 else []
    return rows[-1].get("id") if rows else None


def _in_tray(api: Api, token: str, sale_id: str) -> bool:
    _, body = api.get("/receipts/pending", token=token)
    return any((r.get("sale") or {}).get("id") == sale_id or r.get("sale_id") == sale_id
               for r in _rows(body))


# ── the tanker ─────────────────────────────────────────────────────────

def _a_delivery_counts_what_arrived_not_what_was_billed(api: Api, rep: Report,
                                                        code: str, token: str) -> None:
    """
    Billed 5,000 litres, dipped 4,950. The tank gains 4,950 and the shortage is 50.

    A station that books the invoice figure into the tank is short fifty litres
    it believes it has. Nothing errors — the loss surfaces weeks later as a
    tank that will not reconcile, by which time nobody can say which tanker it
    was.
    """
    status, body = api.get("/fuel/tanks", token=token)
    tanks = _rows(body) if status == 200 else []
    if not tanks:
        rep.query("Q", f"{code} · a tank to deliver into", "none configured")
        return

    tank = tanks[0]
    before = _tank_litres(api, token, tank["id"])
    if before is None:
        rep.query("Q", f"{code} · the tank reports its level", "no figure")
        return

    status, body = api.post("/fuel/deliveries", {
        "fuel_tank_id": tank["id"],
        "invoiced_litres": DELIVERED,
        "dip_before": before,
        "dip_after": before + DIP_RISE,
        "invoice_number": f"SWEEP-{uuid.uuid4().hex[:6]}",
        "tanker_number": "SWP-1234",
    }, token=token)

    if status not in (200, 201):
        rep.bug("Q", f"{code} · record a fuel delivery", _why(status, body))
        return

    delivery = body.get("data") or {}
    short = float(delivery.get("shortage_litres") or 0)
    want_short = DELIVERED - DIP_RISE

    if abs(short - want_short) > 0.01:
        rep.bug("Q", f"{code} · THE SHORTAGE IS THE INVOICE MINUS THE DIP",
                f"billed {DELIVERED:.0f}, dipped {DIP_RISE:.0f}, shortage recorded as {short}")
    else:
        rep.ok("Q", f"{code} · shortage recorded", f"{short:.0f} litres short of the invoice")

    after = _tank_litres(api, token, tank["id"])
    if after is None:
        return

    if abs(after - (before + DIP_RISE)) > 0.01:
        rep.bug("Q", f"{code} · THE TANK GAINS WHAT ARRIVED, NOT WHAT WAS BILLED",
                f"tank was {before}, dip says {DIP_RISE:.0f} went in, tank now reads {after} "
                f"— expected {before + DIP_RISE}"
                + (" (it counted the INVOICE)" if abs(after - (before + DELIVERED)) < 0.01 else ""))
    else:
        rep.ok("Q", f"{code} · tank gained what the dip measured", f"{before} → {after}")


def _tank_litres(api: Api, token: str, tank_id: str) -> float | None:
    status, body = api.get("/fuel/tanks", token=token)
    if status != 200:
        return None
    for t in _rows(body):
        if t.get("id") == tank_id:
            # `current_dip_litres` is what is in the ground. `sellable_litres`
            # is that minus the dead stock a pump cannot lift, and `ullage` is
            # the empty space above it — three numbers about one tank, and a
            # delivery moves the dip.
            if t.get("current_dip_litres") is not None:
                return float(t["current_dip_litres"])
    return None


# ── the rate ───────────────────────────────────────────────────────────

def _a_rate_applies_when_it_says_it_does(api: Api, rep: Report, code: str,
                                         token: str, state: dict) -> None:
    """
    A rate logged for tomorrow must not price today's petrol.

    Price notifications arrive in the evening and take effect at midnight, so a
    station enters tomorrow's rate before it applies. If the till picked it up
    immediately, every litre sold that night would be at the wrong price — and
    on the night rates change, that is the busiest the forecourt gets.
    """
    fuel = _a_fuel_product(api, token)
    if fuel is None:
        rep.query("Q", f"{code} · a fuel product to reprice", "none found")
        return

    today = float(fuel.get("price") or 0)
    tomorrow = round(today + 7, 2)
    at = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0)

    status, body = api.post("/fuel/prices", {
        "product_id": fuel["id"],
        "new_price": tomorrow,
        "effective_at": at.isoformat().replace("+00:00", "Z"),
        "reason": "QA sweep — tomorrow's notification",
    }, token=token)

    if status not in (200, 201):
        rep.bug("Q", f"{code} · log tomorrow's rate", _why(status, body))
        return

    rep.ok("Q", f"{code} · tomorrow's rate logged", f"{today:.2f} → {tomorrow:.2f}")

    # Ring a litre NOW. The server prices it — the sweep never sends a price —
    # and it must still be today's rate.
    status, body = api.post("/sales", {
        "channel": "pos",
        "items": [{"product_id": fuel["id"], "quantity": 1}],
        "payment_method": "cash", "amount_paid": max(today, tomorrow) * 2,
    }, token=token)

    if status not in (200, 201):
        rep.query("Q", f"{code} · sell a litre at today's rate", _why(status, body))
        return

    charged = float(((body.get("data") or {}).get("items") or [{}])[0].get("unit_price") or 0)

    if abs(charged - tomorrow) < 0.01:
        rep.bug("Q", f"{code} · A RATE THAT HAS NOT STARTED DOES NOT PRICE ANYTHING",
                f"tomorrow's rate {tomorrow:.2f} priced a sale made today "
                f"(today's rate is {today:.2f})")
    elif abs(charged - today) > 0.01:
        rep.query("Q", f"{code} · today's litre priced", f"charged {charged}, today's rate is {today}")
    else:
        rep.ok("Q", f"{code} · today's litre kept today's rate", f"{charged:.2f}")


def _a_fuel_product(api: Api, token: str) -> dict | None:
    status, body = api.get("/products?search=Petrol", token=token)
    rows = _rows(body) if status == 200 else []
    if rows:
        return rows[0]
    status, body = api.get("/products", token=token)
    rows = _rows(body) if status == 200 else []
    return rows[0] if rows else None


# ── the catalog a shop can take with it ────────────────────────────────

def _the_shop_can_take_its_catalog_with_it(api: Api, rep: Report, code: str,
                                           token: str, state: dict) -> None:
    """
    A shop's own product list, as a file it can open.

    Not a nicety: it is the only way out of this product, and a shop that
    cannot get its catalog back is locked in whether anybody meant that or not.
    The thing to check is not that a file arrives — it is that the shop's own
    product is IN it, with a price.
    """
    status, body = api.get("/products/export", token=token)
    if status != 200:
        rep.bug("Q", f"{code} · export the catalog", str(status))
        return

    raw = body.get("text") if isinstance(body, dict) else None
    if not raw:
        rep.query("Q", f"{code} · the export has a body", "empty response")
        return

    # The file opens with a BOM, deliberately: without it Excel reads a
    # Pakistani shop's product names as mojibake. `csv.DictReader` does not know
    # that, so the first column comes back keyed "\ufeffName" and every lookup
    # for "Name" misses — which this check reported as every shop exporting a
    # catalog with none of its products in it.
    try:
        rows = list(csv.DictReader(io.StringIO(raw.lstrip("\ufeff"))))
    except Exception as e:  # noqa: BLE001
        rep.bug("Q", f"{code} · the export is readable as CSV", str(e))
        return

    if not rows:
        rep.bug("Q", f"{code} · THE EXPORT CONTAINS THE SHOP'S PRODUCTS",
                "a catalog with items exported zero rows")
        return

    wanted = (state.get("product") or {}).get("name")
    found = next((r for r in rows if (r.get("name") or r.get("Name")) == wanted), None)

    if wanted and found is None:
        rep.bug("Q", f"{code} · THE EXPORT CONTAINS THE SHOP'S PRODUCTS",
                f"{len(rows)} rows and {wanted!r} is not among them")
    else:
        rep.ok("Q", f"{code} · catalog exported", f"{len(rows)} rows, incl. {wanted!r}")


# ── helpers ────────────────────────────────────────────────────────────

def _why(status: int, body: dict) -> str:
    return f"{status} {body.get('errors') or body.get('message')}"


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
