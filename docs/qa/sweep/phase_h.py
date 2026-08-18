"""
Phase H — the till with no server.

Everything before this assumed the shop could reach the internet. In Pakistan
that assumption is wrong for part of most days, and a till that stops when the
line does is not a till. So the counter keeps selling into its own queue and
flushes it later — which means the server has to accept work that was decided
somewhere it does not control, hours after the fact.

That is the whole risk, and it has one shape: **the till is a client, and a
client's arithmetic is never trusted.** A sale rung offline arrives with a total
on it, and the server must ignore that total and price the basket again from its
own catalog. Anything less and "offline mode" is a documented way to pay
whatever you like.

Three more that cost real money:

    FLUSH ORDER      shift opens go first, then sales, then closes — a sale that
                     lands before its shift belongs to no drawer, and a close
                     that lands before its sales counts the wrong money
    IDEMPOTENCY      a lost acknowledgement means the till sends again; the same
                     `op` must return the same sale, not bank it twice
    THE SLIP         the OFF- number the customer is holding must find the sale,
                     or nobody can be refunded for what they bought offline
"""

import urllib.parse
import uuid

from api import Api, Report
from phase_c import PRICE

FLOAT = 2000.0


def run(api: Api, rep: Report, sold: dict) -> dict:
    for code, state in sold.items():
        if not (state.get("features") or {}).get("pos"):
            continue

        token = state["token"]
        device = _device(api, rep, code, token)
        if device is None:
            continue

        _bootstrap_feeds_the_till(api, rep, code, token, state["product"]["id"])
        _the_queue_arrives_in_order(api, rep, code, token, device, state)

    return sold


# ── the till announcing itself ─────────────────────────────────────────

def _device(api: Api, rep: Report, code: str, token: str) -> str | None:
    """
    A till registers on every boot, not only the first.

    How long ago a device last called IS the offline policy — a till that has
    been silent for a week is not a till that is offline, it is a till that has
    gone. So the touch matters more than the registration.
    """
    device_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"sweep-{code}.qa.test"))

    status, body = api.post("/pos/devices", {
        "device_id": device_id, "name": f"Sweep Till ({code})", "platform": "web",
    }, token=token)

    if status not in (200, 201):
        rep.bug("H", f"{code} · a till can register", _why(status, body))
        return None

    rep.ok("H", f"{code} · till registered")
    return device_id


def _bootstrap_feeds_the_till(api: Api, rep: Report, code: str, token: str, product_id: str) -> None:
    """
    The catalog as the till holds it, and the settings that govern the drawer.

    One shape, two modes: no cursor is a first load, a cursor is everything
    since. The cursor is PER COLLECTION — `?products=…&categories=…` — because
    a till that re-pulled every customer to learn one price change would spend
    the shop's data allowance on nothing.

    The settings ride along because a shop that requires a tender declaration at
    close must still be asked for one with no server; the till cannot look them
    up at the moment it needs them.
    """
    status, body = api.get("/pos/bootstrap", token=token)
    if status != 200:
        rep.bug("H", f"{code} · the till can load its catalog", str(status))
        return

    # Each collection arrives as `{items, cursor, has_more}`, not as a bare
    # list, and the CURSOR is inside it — not `server_time`.
    #
    # The first version of this read `data.products` as the list and reported
    # "3 products" for every trade, which is the number of KEYS in the envelope.
    # It counted the box, not what was in it, and printed a pass seven times.
    # This repo already has a standing rule about exactly that: never assert on
    # an envelope.
    d = body.get("data") or {}
    box = d.get("products") or {}
    products = box.get("items") or []
    watermark = box.get("cursor")
    settings = d.get("settings") or {}

    if not products:
        rep.bug("H", f"{code} · THE TILL IS GIVEN SOMETHING TO SELL",
                "bootstrap returned an empty catalog — the offline pane would be blank")
        return
    rep.ok("H", f"{code} · bootstrap · {len(products)} products")

    for key in ("pos_blind_close", "pos_denomination_count", "pos_declare_tenders"):
        if key not in settings:
            rep.bug("H", f"{code} · THE DRAWER RULES REACH THE TILL",
                    f"{key} absent from bootstrap settings — the offline close cannot obey it")
            return
    rep.ok("H", f"{code} · drawer rules reached the till")

    if not watermark:
        rep.bug("H", f"{code} · bootstrap hands back a cursor",
                f"nothing to pull a delta from; products envelope: {sorted(box)}")
        return

    # 1 · nothing has changed, so the delta must be EMPTY. A delta that returns
    #     the whole catalog every time is not a delta — it is a full pull with
    #     extra steps, and on a 2G forecourt that is the difference between a
    #     till that syncs and one that never finishes.
    # The cursor is "<updated_at>|<id>" — it carries a space and a pipe, and
    # sending it raw does not reach the server at all. A status of 0 here means
    # the request never left, which looked exactly like the endpoint being down.
    since = urllib.parse.quote(watermark)

    status, body = api.get(f"/pos/catalog?products={since}", token=token)
    if status != 200:
        rep.bug("H", f"{code} · the delta endpoint answers", str(status))
        return

    quiet = ((body.get("data") or {}).get("products") or {}).get("items") or []
    if quiet:
        rep.bug("H", f"{code} · A DELTA SENDS ONLY WHAT CHANGED",
                f"nothing changed and it returned {len(quiet)} of {len(products)} products")
    else:
        rep.ok("H", f"{code} · delta with no changes is empty", f"catalog holds {len(products)}")

    # 2 · change one thing; the delta must carry exactly that.
    api.put(f"/products/{product_id}", {"description": f"sweep delta {watermark}"}, token=token)

    status, body = api.get(f"/pos/catalog?products={since}", token=token)
    changed = ((body.get("data") or {}).get("products") or {}).get("items") or []
    if not any(p.get("id") == product_id for p in changed):
        rep.bug("H", f"{code} · A CHANGED PRODUCT REACHES THE TILL",
                f"the product was edited and the delta since {watermark} does not carry it")
    else:
        rep.ok("H", f"{code} · the edit reached the delta", f"{len(changed)} changed")


# ── the queue ──────────────────────────────────────────────────────────

def _the_queue_arrives_in_order(api: Api, rep: Report, code: str, token: str,
                                device: str, state: dict) -> None:
    """The night's work, sent in the order the till is required to send it."""
    session_id = str(uuid.uuid4())
    op_open = f"sweep-open-{session_id[:8]}"

    # 1 · the shift, first. A sale that lands before its shift belongs to no
    #     drawer and shows up in no reconciliation.
    status, body = api.post("/pos/sync/shifts", {
        "device_id": device,
        "operations": [{
            "op": op_open, "kind": "open", "at": _now(api),
            "session_id": session_id, "opening_float": FLOAT,
        }],
    }, token=token)

    if status not in (200, 201):
        rep.bug("H", f"{code} · an offline shift open arrives", _why(status, body))
        return
    rep.ok("H", f"{code} · offline shift open accepted")

    # 2 · the sale, claiming a price of its own.
    op = str(uuid.uuid4())
    slip = f"OFF-{code[:3].upper()}-{op[:6].upper()}"
    payload = {
        "device_id": device,
        "operations": [{
            "op": op, "at": _now(api), "offline_number": slip,
            "sale": {
                "channel": "pos",
                "cash_session_id": session_id,
                "customer_name": "Sweep Offline Buyer",
                "items": [{
                    "product_id": state["product"]["id"], "quantity": 2,
                    "unit_price": 1,     # ← the till's arithmetic
                    "line_total": 2,     # ←
                }],
                "tax": 999,              # ←
                "payment_method": "cash",
                "amount_paid": 2 * PRICE,
            },
        }],
    }
    status, body = api.post("/pos/sync", payload, token=token)
    if status not in (200, 201):
        rep.bug("H", f"{code} · an offline sale arrives", _why(status, body))
        return

    # The response is a RECEIPT REFERENCE — `{op, status, sale_id,
    # invoice_number, offline_number, violations}` — not the sale itself. Right:
    # a till that already printed its slip needs the server's number and whether
    # anything about the sale was contested, not the basket read back to it.
    result = _first_op(body)
    if result is None or not result.get("sale_id"):
        rep.bug("H", f"{code} · the sync says what it created",
                f"payload: {body.get('data')}")
        return

    if result.get("violations"):
        rep.query("H", f"{code} · the sale arrived without violations",
                  str(result["violations"]))

    sale = _fetch(api, token, result["sale_id"])
    if sale is None:
        rep.bug("H", f"{code} · the synced sale can be read back", result["sale_id"])
        return

    total = float(sale.get("total") or 0)
    if abs(total - 2 * PRICE) > 0.01:
        rep.bug("H", f"{code} · A SYNCED SALE IS RE-PRICED BY THE SERVER",
                f"the till said 2, the server stored {total}")
    else:
        rep.ok("H", f"{code} · offline sale re-priced on arrival", f"{total:.0f} not 2")

    if float(sale.get("tax") or 0) > 0.01:
        rep.bug("H", f"{code} · a synced sale's tax is the server's",
                f"tax = {sale.get('tax')}")

    # 3 · the same op again — a lost acknowledgement, which is the normal case.
    status, body = api.post("/pos/sync", payload, token=token)
    again = _first_op(body) if status in (200, 201) else None

    if again is None:
        rep.query("H", f"{code} · re-sending an op is accepted", str(status))
    elif again.get("sale_id") != result["sale_id"]:
        rep.bug("H", f"{code} · THE SAME OP CANNOT BANK TWICE",
                f"a re-send created {again.get('sale_id')} beside {result['sale_id']}")
    else:
        rep.ok("H", f"{code} · re-sent op returned the same sale", again.get("status") or "")

    # 4 · the slip in the customer's hand must find it.
    _the_slip_finds_the_sale(api, rep, code, token, slip, sale)

    # 5 · the close, last — after the sales it has to count.
    status, body = api.post("/pos/sync/shifts", {
        "device_id": device,
        "operations": [{
            "op": f"sweep-close-{session_id[:8]}", "kind": "close", "at": _now(api),
            "session_id": session_id, "counted_cash": FLOAT + 2 * PRICE,
            "notes": "QA sweep offline close",
        }],
    }, token=token)

    if status not in (200, 201):
        rep.bug("H", f"{code} · an offline close arrives", _why(status, body))
        return

    closed = _first_op(body)
    variance = (closed or {}).get("variance")
    if variance is None:
        rep.ok("H", f"{code} · offline close accepted")
    elif abs(float(variance)) > 0.01:
        rep.query("H", f"{code} · the offline drawer counted out level",
                  f"float {FLOAT:.0f} + {2 * PRICE:.0f} sold, variance {variance}")
    else:
        rep.ok("H", f"{code} · offline drawer counted out level", "variance 0")


def _the_slip_finds_the_sale(api: Api, rep: Report, code: str, token: str,
                             slip: str, sale: dict) -> None:
    """
    The receipt says OFF-…; searching for it must return the sale.

    This is not a nicety. The offline number is the ONLY reference the customer
    has — the invoice number was minted on the server hours later — so a slip
    that matches nothing means nobody can be refunded for anything bought while
    the line was down. The Help Centre promised this worked before it did.
    """
    status, body = api.get(f"/sales?search={slip}", token=token)
    rows = _rows(body) if status == 200 else []
    if not any(r.get("id") == sale.get("id") for r in rows):
        rep.bug("H", f"{code} · THE OFF- SLIP FINDS THE SALE",
                f"searching {slip} in the sales ledger returned {len(rows)} rows, none of them it")
    else:
        rep.ok("H", f"{code} · the OFF- slip finds the sale", slip)

    # And the global search box, which is where a cashier actually types it.
    status, body = api.get(f"/search?q={urllib.parse.quote(slip)}", token=token)
    if status != 200:
        rep.query("H", f"{code} · global search reached", str(status))
        return

    # `{query, total, groups: [{type, label, items}]}` — grouped, because the
    # palette shows a heading per kind. Reading `data.sales` finds nothing and
    # looks precisely like the slip being unsearchable.
    d = body.get("data") or {}
    sales = next((g.get("items") or [] for g in (d.get("groups") or [])
                  if g.get("type") == "sale"), [])
    found = [s for s in sales if s.get("id") == sale.get("id")]
    if not found:
        rep.bug("H", f"{code} · THE SLIP IS FOUND FROM THE SEARCH BOX",
                f"{slip} is in the ledger but not in global search")
    else:
        rep.ok("H", f"{code} · global search finds the slip")


# ── plumbing ───────────────────────────────────────────────────────────

def _fetch(api: Api, token: str, sale_id: str) -> dict | None:
    status, body = api.get(f"/sales/{sale_id}", token=token)
    return (body.get("data") or {}) if status == 200 else None


def _first_op(body: dict) -> dict | None:
    d = body.get("data") or {}
    for key in ("results", "operations", "accepted", "ops"):
        rows = d.get(key)
        if isinstance(rows, list) and rows:
            return rows[0]
    return None


def _now(api: Api) -> str:
    status, body = api.get("/health")
    return ((body.get("data") or {}).get("time") if status == 200 else None) or "2026-08-18T12:00:00+00:00"


def _why(status: int, body: dict) -> str:
    return f"{status} {body.get('errors') or body.get('message')}"


def _rows(body: dict) -> list:
    raw = body.get("data") or []
    return raw if isinstance(raw, list) else raw.get("data", [])
