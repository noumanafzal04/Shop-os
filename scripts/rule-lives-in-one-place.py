#!/usr/bin/env python3
r"""
A RULE THAT HAS A HOME MUST NOT BE REBUILT OUTSIDE IT.

This codebase keeps meeting one shape of bug: a business question asked in
several places and answered differently in each.

  · "what is running low" — asked in five places, answered two ways, and a rail
    holding two hundred shirts was on the buying list every morning. Now
    `App\Support\LowStock`.
  · "what does the shop owe its suppliers" — the supplier card counted DRAFT
    orders as debt while the dashboard did not, so the same account carried two
    figures on two screens. Now `App\Support\Payable`.

Both were fixed by giving the question ONE home. Nothing stops the sixth copy
from being written tomorrow, next to the class that exists to prevent it — and
a wrong copy beside an ignored helper is the exact failure both of those were.

So this reads the rule classes themselves. It learns each one's characteristic
predicates from its own source, then looks for the same combination anywhere
else. No hand-maintained list of rules: add a class to `app/Support` that builds
a query, and it is guarded from that moment.

Consciously narrow. It does NOT flag a business question asked twice when
neither copy has been named yet — that needs a person to decide what the
concept IS. It flags the ones somebody already decided about.
"""
from __future__ import annotations

import itertools
import pathlib
import re
import sys

SUPPORT = pathlib.Path("app/Support")
APP = pathlib.Path("app")

# Columns that say WHOSE row this is, not what the rule means. Every query has
# them; they carry no rule.
SCOPING = {
    "tenant_id", "branch_id", "deleted_at", "id", "user_id", "product_id",
    "variant_id", "supplier_id", "customer_id", "is_default", "created_by",
    "sale_id", "order_id", "purchase_order_id", "category_id", "parent_id",
    "register_id", "cash_session_id", "plan_id",
}

PREDICATE = re.compile(
    r"->(where|whereNot|whereIn|whereNotIn|whereColumn|whereNull|whereNotNull|whereRaw)"
    r"\(\s*'([a-z_.]+)'((?:[^();]|\([^()]*\))*)\)"
)


def predicates(src: str) -> set[str]:
    """The domain predicates in a piece of source, normalised."""
    out = set()
    for m in PREDICATE.finditer(src):
        column = m.group(2).split(".")[-1]
        if column in SCOPING:
            continue
        value = re.sub(r"[^A-Za-z0-9<>!=,]", "", m.group(3))[:30]
        out.add(f"{m.group(1)}({column}{value})")

    return out


def statements(src: str) -> list[str]:
    """Source split at statement boundaries.

    Granularity is the whole precision of this tool. Read per FILE, it paired
    `where('method', 'cash')` from one query with a status filter from another
    thirty lines away and called that a rebuilt rule. A rule is rebuilt inside
    ONE query, so a statement is the unit.
    """
    return src.split(";")


def rule_classes() -> dict[str, set[str]]:
    """Support classes that build queries -> the predicates that define them."""
    rules: dict[str, set[str]] = {}
    for f in sorted(SUPPORT.glob("*.php")):
        src = f.read_text()
        if "Builder" not in src:
            continue
        preds = predicates(src)
        # Two is the smallest combination that can express a rule; one
        # predicate is a filter, and filters are everybody's.
        if len(preds) >= 2:
            rules[f.stem] = preds

    return rules


def main() -> int:
    check = "--check" in sys.argv
    rules = rule_classes()
    print(f"{len(rules)} rule classes in app/Support that build a query:")
    for name, preds in rules.items():
        print(f"  {name:16} {len(preds)} predicates")

    if not rules:
        print("\nNO RULE CLASSES FOUND — the parser has drifted, not the code.")
        return 2

    files = [f for f in APP.rglob("*.php") if f.parent != SUPPORT]
    print(f"\n{len(files)} files outside app/Support examined")
    if len(files) < 200:
        print("ALMOST NOTHING SCANNED — the parser has drifted.")
        return 2

    findings: list[str] = []
    examined = 0
    for f in files:
        for stmt in statements(f.read_text()):
            mine = predicates(stmt)
            if len(mine) < 2:
                continue
            examined += 1
            for name, preds in rules.items():
                shared = mine & preds
                # Two of a rule's own predicates in ONE query, outside the rule,
                # is the rule being rebuilt. One is a coincidence — plenty of
                # things ask whether a row is active.
                if len(shared) >= 2:
                    for combo in itertools.combinations(sorted(shared), 2):
                        findings.append(f"{f}  rebuilds {name}: {combo[0]} + {combo[1]}")

    print(f"{examined} queries carrying two or more domain predicates")

    if findings:
        print(f"\n{len(findings)} PLACE(S) REBUILDING A RULE THAT HAS A HOME\n")
        for line in sorted(set(findings)):
            print(f"  {line}")
        print("\nAsk of each: call the rule, or say beside it why this one differs.")
    else:
        print("\nEvery named rule is asked only through its own class.")

    if check:
        return 1 if findings else 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
