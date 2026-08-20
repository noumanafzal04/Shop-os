#!/usr/bin/env python3
"""
One question, several paths, and only some of them answering.

    python3 scripts/one-rule-many-paths.py            report
    python3 scripts/one-rule-many-paths.py --prove     break it on purpose first

── Why ─────────────────────────────────────────────────────────────────────

Three places in this codebase can start selling something: the counter
(`CreateSaleAction`), an order (`OrderService::place`) and a dine-in tab
(`AddTicketItemsAction`). Each one asks a list of questions before it agrees —
is this item active, is it within its serving hours, is there enough of it.

Twice now a rule has lived on one of those lists and not the others:

  ITEM_SOLD_OUT          the counter refused a dish taken off tonight's menu.
                         The app took the order anyway and the tab printed a
                         kitchen ticket. Fixed 2026-08-20.

  DISCOUNT_LIMIT_EXCEEDED  the shop's discount ceiling was consulted in
                         `CreateSaleAction` alone, so a cashier capped at the
                         counter was uncapped the moment the same bill was a
                         table — and settlement rings on the trusted path, which
                         skips the counter's check too. Fixed the same day.

Both were found by listing what each path refuses and reading the difference.
This is that list.

── How to read it ──────────────────────────────────────────────────────────

Most differences are correct. A delivery fee has no meaning at a counter and a
trade-in has none online, so a long "only here" column is expected and healthy.

What matters is the ONE question: for each code only one path throws, **could
the others be asked it?** `EXPECTED` records the answer per code, in a few
words. A code with no entry is unexamined and the run exits non-zero.

Which means the useful moment for this tool is not the clean run — it is the day
somebody adds a new refusal to one path. The tool then asks, before the branch
merges, whether the other two need it.

── Shared guards ───────────────────────────────────────────────────────────

A code thrown by a Support class belongs to every path that calls it — which is
what fixing `DISCOUNT_LIMIT_EXCEEDED` did. `SHARED` maps the guard to its file
so the tool credits the callers rather than reporting the rule as missing from
all three.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# The paths that answer ONE question: may this be sold, to this person, now.
#
# `SettleTicketAction` is deliberately NOT a peer here. It does not decide
# whether something may be sold — it takes the money for food already eaten,
# on the trusted path, and re-asking the item rules there would refuse a bill
# the shop has already served. Adding it to this set collapsed the intersection
# to zero, which is the tool losing its most useful line rather than finding
# anything.
#
# What settle DOES share is the giving-away question, and that is asserted
# directly below instead of compared.
PATHS = {
    "counter": "app/Actions/Sale/CreateSaleAction.php",
    "order": "app/Services/OrderService.php",
    "tab": "app/Actions/Restaurant/AddTicketItemsAction.php",
}

# The ceiling is not "may this be sold" — it is "how much may be given away",
# and the three places that can give it away are the counter, the tab and the
# settlement. That is a fixed invariant rather than a comparison, so it is
# asserted by name: the guard must be CALLED by each of them.
GIVES_MONEY_AWAY = [
    "app/Actions/Sale/CreateSaleAction.php",
    "app/Actions/Restaurant/AddTicketItemsAction.php",
    "app/Actions/Restaurant/SettleTicketAction.php",
]

# A guard's codes count for whoever calls it.
SHARED = {
    "DiscountCeiling::assert": "app/Support/DiscountCeiling.php",
    "ModifierResolver::resolve": "app/Support/ModifierResolver.php",
}

CODE = re.compile(r"'([A-Z][A-Z0-9_]{3,})'")

# Why a rule belongs to some paths and not others. Read as: "only these ask it,
# because …". The entries are short on purpose; a paragraph nobody reads is the
# same as no entry.
EXPECTED: dict[str, str] = {
    # Tenders and captures that exist only where a person is standing at a till.
    "CREDIT_EXCEEDS_DUE": "khata is a counter tender",
    "CREDIT_REQUIRES_CUSTOMER": "khata is a counter tender",
    "INSUFFICIENT_POINTS": "points are redeemed at the counter",
    "LOYALTY_DISABLED": "points are redeemed at the counter",
    "LOYALTY_REQUIRES_CUSTOMER": "points are redeemed at the counter",
    "POINTS_BELOW_MIN": "points are redeemed at the counter",
    "POINTS_EXCEED_BILL": "points are redeemed at the counter",
    "TRADE_IN_EXCEEDS_TOTAL": "goods are handed over a counter",
    "TRADE_IN_INVALID": "goods are handed over a counter",
    "TRADE_IN_NOT_STOCKABLE": "goods are handed over a counter",
    "SERIAL_ALREADY_SOLD": "an IMEI is captured at handover; an order captures none",
    "SERIAL_COUNT_EXCEEDS_QTY": "an IMEI is captured at handover",
    "SERIAL_DUPLICATE_IN_SALE": "an IMEI is captured at handover",
    "PAYMENT_INSUFFICIENT": "only the counter takes the money in the same breath",
    "TRAINING_NOT_AVAILABLE": "a practice till is a counter idea",
    "PRESCRIPTION_REQUIRED": "the order path has its own, stronger RX_IN_PERSON_ONLY",
    "DISCOUNT_EXCEEDS_SUBTOTAL": "arithmetic on a hand-keyed discount; the tab clamps instead",

    # Fulfilment and shopfront rules, which only exist for a stranger ordering.
    "DELIVERY_DISABLED": "there is no delivery at a counter",
    "PICKUP_DISABLED": "there is no pickup at a counter",
    "ORDER_NOT_DELIVERY": "an order-lifecycle rule",
    "ORDER_NOT_ASSIGNABLE": "an order-lifecycle rule",
    "ORDER_NOT_CANCELLABLE": "an order-lifecycle rule",
    "ORDER_INVALID_TRANSITION": "an order-lifecycle rule",
    "OUT_OF_DELIVERY_AREA": "a delivery rule",
    "MIN_ORDER_AMOUNT": "a delivery rule; a shopkeeper on the phone overrides it",
    "ORDERING_DISABLED": "the shopfront's own switch",
    "SHOP_CLOSED": "opening hours gate strangers, not the staff inside",
    "RX_IN_PERSON_ONLY": "the counter has a pharmacist; this is the online refusal",

    # The tab's own lifecycle.
    "TICKET_NOT_OPEN": "only a tab has a tab to be closed",
}


def codes_in(path: str) -> set[str]:
    src = (ROOT / path).read_text()
    found = set(CODE.findall(src))

    for call, guard in SHARED.items():
        if call in src:
            found |= set(CODE.findall((ROOT / guard).read_text()))

    return found


def ceiling_is_asked_everywhere() -> list[str]:
    """The three paths that can give money away must all call the one guard."""
    return [f for f in GIVES_MONEY_AWAY
            if "DiscountCeiling::assert" not in (ROOT / f).read_text()]


def report(mutate: str | None = None) -> tuple[list[str], int]:
    paths = {} if mutate == "blind" else {n: codes_in(f) for n, f in PATHS.items()}

    if not paths:
        print("0 paths read · 0 codes\n")
        return [], 0

    shared = set.intersection(*paths.values())
    total = len(set.union(*paths.values()))

    print(f"{len(paths)} paths · {total} distinct refusals · {len(shared)} asked by all of them\n")
    print("EVERY PATH ASKS THESE:")
    for c in sorted(shared):
        print(f"  {c}")

    unexamined = []
    for name, mine in paths.items():
        only = mine - set.union(*[c for n, c in paths.items() if n != name])
        if not only:
            continue
        print(f"\nONLY {name} ASKS ({len(only)}):")
        for c in sorted(only):
            why = EXPECTED.get(c)
            print(f"  {c:28} {why or '←  UNEXAMINED: could the others be asked this?'}")
            if why is None:
                unexamined.append(f"{name}:{c}")

    stale = [c for c in EXPECTED if c not in set.union(*paths.values())]
    if stale:
        print("\nEXPECTED names codes no path throws any more — delete these:")
        for c in sorted(stale):
            print(f"  · {c}")

    missing = ceiling_is_asked_everywhere()
    if missing:
        print("\nTHE DISCOUNT CEILING IS NOT ASKED BY EVERY PATH THAT GIVES MONEY AWAY:")
        for f in missing:
            print(f"  · {f}")
        unexamined += [f"ceiling:{f}" for f in missing]
    else:
        print("\nThe discount ceiling is asked by the counter, the tab and the settlement.")

    if unexamined:
        print(f"\n{len(unexamined)} thing(s) with nobody's word on them.")
    else:
        print("Every difference has a reason beside it.")

    return unexamined, total


def prove() -> int:
    """
    Blind it and require the result to LOOK blind.

    Reading nothing prints no differences at all, which is what a codebase with
    four identical paths would print. Only the count separates them.
    """
    print("── proving it can fail ──\n")
    leads, total = report(mutate="blind")

    if total != 0 or leads:
        print("\nBROKEN: a detector reading nothing still had something to say")
        return 1

    print("blinded: 0 codes, 0 differences — a clean-looking verdict from a scan")
    print("that read nothing. Read the count, not the words.\n")

    # And the rule it exists for: a code the counter throws and the tab does not
    # must land in the "only counter" column. PAYMENT_INSUFFICIENT is that shape
    # and has been since the day the tab was written.
    counter = codes_in(PATHS["counter"])
    tab = codes_in(PATHS["tab"])
    assert "PAYMENT_INSUFFICIENT" in counter - tab, \
        "the scan cannot see a refusal that one path has and another does not"

    # And a shared guard must be credited to its callers, or fixing a rule by
    # extracting it would read as removing it from everywhere.
    assert "DISCOUNT_LIMIT_EXCEEDED" in counter & tab, \
        "a code thrown by a shared guard is not being credited to its callers"
    print("both shapes this tool exists to see are asserted against.\n")

    leads, total = report()

    if total == 0:
        print("\nBROKEN: the real run read no codes either")
        return 1

    return 1 if leads else 0


if __name__ == "__main__":
    if "--prove" in sys.argv:
        raise SystemExit(prove())

    leads, total = report()
    raise SystemExit(1 if (leads or total == 0) else 0)
