#!/usr/bin/env python3
"""
Rules this codebase states and never consults.

    python3 scripts/dead-rules.py            report
    python3 scripts/dead-rules.py --prove    break it on purpose first

── Why ─────────────────────────────────────────────────────────────────────

`Product::scopeSellableToday()` had one definition and **zero callers**. It was
the rule that a dish taken off tonight's menu must not be sold — and because
nobody called it, the till enforced that rule while the online order and the
dine-in tab did not. Three paths, one question, and only one of them asked.

`StockDisposal::isCredited()` had zero callers too. The endpoint that records a
supplier credit never checked whether one had already been recorded, so a retry
could silently replace a settled money figure with a different one.

Both were found by hand, by grepping. This is the grep, kept.

── What it is NOT ──────────────────────────────────────────────────────────

**These are leads, not findings.** The first hand-run turned up eight uncalled
predicates: one was a real gap and seven were one-line derivations of a field
that other code checks directly — `isRequired()` returning `min_select > 0`
while `ModifierResolver` reads `min_select` itself. Redundant, not dangerous.

So every lead needs a human to answer one question:

    **Does some other path enforce this rule, or does nobody?**

`SETTLED` records the answers, one line each, so the list stays short enough
that somebody reads it. A lead with no entry is unexamined. An entry whose
method has since gained a caller, or vanished, is reported too — a stale
exception list is worse than none, because it is believed.

── How it resolves a call, and what that costs ─────────────────────────────

**By method NAME, not by class.** PHP calls a method on a runtime value
(`$product->isSoldOut()`), and knowing which class that value holds needs type
inference this does not have. So `isOpen()` — declared on twelve different
models — counts as called if ANYTHING calls an `isOpen()`.

That UNDER-reports, and deliberately: the alternative is twelve rows for one
name, of which eleven are noise, on a list whose only value is that a person
reads it. What survives is a name **nothing anywhere asks**, which is exactly
the shape both real findings had.

The first version of this file got the matching backwards. Its pattern excluded
`>` so as to skip declarations, which is precisely how PHP calls a method — so
it reported 62 of 74 rules as uncalled, including one wired into three call
sites an hour earlier. **Suspect the parser before the code**: a detector that
finds far more than it should has usually stopped reading the language.
"""

import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Where a call could come from. `database/` is here because a seeder or a
# migration consulting a rule still counts as somebody asking.
SEARCHED = ["app", "database", "routes", "tests"]

# A method whose NAME is a decision. These are the ones worth chasing: a rule
# stated as a question that nothing ever asks is a rule nothing enforces.
PREDICATE = re.compile(
    r"public function ((?:is|has|can|must|should|requires|needs|allows)[A-Z]\w*)\s*\("
)
SCOPE = re.compile(r"public function scope([A-Z]\w+)\s*\(")

# Leads already answered. The value is WHY it is not a defect — written down so
# the next person can disagree with the reasoning instead of re-deriving it.
SETTLED: dict[str, str] = {
    "isConsumed": "OtpService::verify selects whereNull(consumed_at) under lockForUpdate — "
                  "the rule is in the query, not the predicate",
    "isInStock": "CreateSaleAction checks the ProductSerial registry status AND SaleItemSerial "
                 "across live sales, both under a row lock",
    "isReversed": "both trade-in reversal paths select whereNull(reversed_at)",
    "isRequired": "one-line derivation of min_select; ModifierResolver reads min_select itself",
    "isService": "one-line derivation of type; every call site checks the type directly",
    "isCustomer": "one-line derivation of role; the customer routes gate on the role",
    "isPlatform": "platform access is gated on permissions, not on the role enum",
}


def declared() -> dict[str, tuple[str, set[str]]]:
    """name -> (kind, the classes declaring it)."""
    out: dict[str, tuple[str, set[str]]] = {}
    classes: dict[str, set[str]] = defaultdict(set)
    kinds: dict[str, str] = {}

    for f in (ROOT / "app").rglob("*.php"):
        src = f.read_text()
        for m in PREDICATE.finditer(src):
            classes[m.group(1)].add(f.stem)
            kinds[m.group(1)] = "predicate"
        for m in SCOPE.finditer(src):
            name = m.group(1)
            name = name[0].lower() + name[1:]
            classes[name].add(f.stem)
            kinds[name] = "scope"

    for name, cls in classes.items():
        out[name] = (kinds[name], cls)
    return out


def callers(name: str) -> list[str]:
    """
    Every line that calls `name(` and is not its own declaration.

    `->name(`, `::name(`, `$this->name(` and a bare `name(` all count. The one
    thing filtered out is the `function name(` line, which is the declaration —
    and `function scopeName(` too, since a scope is declared under a longer
    name than it is called by.
    """
    found = subprocess.run(
        ["grep", "-rn", "--include=*.php", f"{name}(", *SEARCHED],
        cwd=ROOT, capture_output=True, text=True,
    ).stdout.splitlines()

    decl = re.compile(rf"function\s+(scope)?{re.escape(name)}\s*\(", re.I)

    return [line for line in found
            if not decl.search(line) and not is_prose(line)]


# Comments out, code in — the same rule `confirm/native.test.ts` had to learn.
#
# This tool did not find the very bug it was built from. The controller's own
# docblock explains that `StockDisposal::isCredited()` had sat unused, and the
# test beside it says the same thing, and both lines contain `isCredited(`. So
# with the fix deliberately removed the scan still reported two callers and no
# lead. A file that EXPLAINS the rule it now enforces is not a file that
# enforces it.
PROSE = re.compile(r"^\s*(\*|//|#|/\*)")


def is_prose(grep_line: str) -> bool:
    """A grep hit that lives in a comment rather than in code."""
    parts = grep_line.split(":", 2)

    return len(parts) == 3 and bool(PROSE.match(parts[2]))


def report(mutate: str | None = None) -> tuple[list[str], int]:
    rules = {} if mutate == "blind" else declared()

    unexamined, examined = [], []
    for name, (kind, cls) in sorted(rules.items()):
        if callers(name):
            continue
        (examined if name in SETTLED else unexamined).append((kind, name, cls))

    print(f"{len(rules)} rule-shaped names declared · "
          f"{len(unexamined) + len(examined)} that nothing calls\n")

    if unexamined:
        print("NOBODY ASKS THESE, AND NOBODY HAS SAID WHY:")
        for kind, name, cls in unexamined:
            print(f"  {kind:9} {name}()   on {', '.join(sorted(cls))}")
        print("\n  Ask of each: does another path enforce this rule, or does nobody?")
        print("  Then add a line to SETTLED saying which — including when the answer")
        print("  is 'it is redundant', because that is the common case.\n")
    elif rules:
        print("Every uncalled rule has an answer beside it in SETTLED:\n")
        for kind, name, cls in examined:
            print(f"  {kind:9} {name}()   {SETTLED[name]}")
        print()

    # A stale exception is worse than no exception, because it is believed. A
    # BLINDED run read no methods at all, so it has nothing to say about which
    # entries are stale — every one of them would look gone.
    gone = [n for n in SETTLED if n not in rules] if rules else []
    revived = [n for n in SETTLED if n in rules and callers(n)]

    if rules and gone:
        print("SETTLED names methods that no longer exist — delete these entries:")
        for n in gone:
            print(f"  · {n}")
    if revived:
        print("SETTLED names methods that HAVE a caller now — delete these entries:")
        for n in revived:
            print(f"  · {n}")

    # A stale exception is worse than no exception, because it is believed —
    # so it counts as a lead, not a footnote. Both of these have now happened:
    # `agedBeyond` sat in SETTLED as "never wired to the batches endpoint" on
    # the morning it was wired to two, and the run still exited 0.
    return [n for _k, n, _c in unexamined] + [f"stale:{n}" for n in gone + revived], len(rules)


def prove() -> int:
    """
    Blind the detector and require the result to LOOK blind.

    Reading nothing prints no leads at all, which is character for character
    what a clean codebase prints. The DENOMINATOR is the only thing that
    separates them, so that is what this asserts on — never the verdict.
    """
    print("── proving it can fail ──\n")

    # The two mistakes this file actually made, asserted rather than trusted.
    #
    # It reported 62 of 74 rules uncalled because its pattern excluded `>`,
    # which is how PHP calls a method. And it failed to find the very bug it
    # was built from, because the controller's own docblock EXPLAINS that
    # `isCredited()` had sat unused and the grep counted the explanation.
    assert callers("isSoldOut"), "a method wired into three call sites reads as uncalled"
    assert is_prose("a.php:75:     * `StockDisposal::isCredited()` had been sitting there"), \
        "a docblock mentioning a method counts as calling it"
    assert is_prose("a.php:12:        // not check, and isCredited() had sat unused"), \
        "a // comment counts as calling it"
    assert not is_prose("a.php:99:        if ($disposal->isCredited()) {"), \
        "real code is being thrown away as prose"
    print("the two mistakes this scan already made are asserted against.\n")

    leads, count = report(mutate="blind")

    if count != 0 or leads:
        print("\nBROKEN: a detector reading nothing still had something to say")
        return 1

    print("blinded: 0 names declared, 0 leads — a clean-looking verdict from a")
    print("scan that read nothing. Read the count, not the words.\n")

    leads, count = report()

    if count == 0:
        print("\nBROKEN: the real run found no methods either")
        return 1

    # A floor, not an equality: the number grows as the product does, and a
    # scan that suddenly reads a handful is a scan that broke rather than a
    # codebase that shrank. Names, not methods — twelve models declare
    # `isOpen()` and that is one name.
    if count < 40:
        print(f"\nBROKEN: only {count} rule-shaped names found; this codebase has ~57")
        return 1

    return 1 if leads else 0


if __name__ == "__main__":
    if "--prove" in sys.argv:
        raise SystemExit(prove())

    leads, count = report()
    raise SystemExit(1 if (leads or count == 0) else 0)
