#!/usr/bin/env python3
"""
The whole sweep, in the order the runbook argues for.

    python3 run.py            every phase
    python3 run.py a b        just those

Each phase needs what the one before it BUILT — there is no shop to sell from
until A has made one, and nothing to sell until B has said what the trade may
stock. Running one alone is possible only because the earlier phases are
re-runnable and reuse what they find.
"""

import sys

from api import Api, Report

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

PHASES = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"]


# What each phase needs standing before it. Naming a late phase alone runs its
# prerequisites too — asking for "the seams" and silently getting only the admin
# side is the kind of quiet no-op that makes a sweep untrustworthy.
NEEDS = {"a": [], "b": ["a"], "c": ["b"], "d": ["c"], "e": ["c"], "f": ["c"], "g": ["c"], "h": ["c"], "i": ["c"], "j": ["c"], "k": ["c"], "l": ["c"], "m": ["c"]}


def _with_prerequisites(want: list[str]) -> set[str]:
    out: set[str] = set()
    todo = list(want)
    while todo:
        p = todo.pop()
        if p in out:
            continue
        out.add(p)
        todo.extend(NEEDS.get(p, []))
    return out


def main() -> int:
    asked = [p.lower() for p in sys.argv[1:]] or PHASES
    unknown = [p for p in asked if p not in PHASES]
    if unknown:
        print(f"unknown phase(s): {unknown}; known: {PHASES}")
        return 2

    want = _with_prerequisites(asked)
    if want != set(asked):
        print(f"running {sorted(want)} — {sorted(want - set(asked))} needed first\n")

    api, rep = Api(), Report()

    tenants = phase_a.run(api, rep)
    if not tenants:
        rep.summary()
        return 1

    shops = phase_b.run(api, rep, tenants) if "b" in want else {}
    sold = phase_c.run(api, rep, shops) if "c" in want else {}

    if "d" in want:
        phase_d.run(api, rep, sold)

    if "e" in want:
        phase_e.run(api, rep, sold)

    if "f" in want:
        # Phase F needs the ADMIN token back to move a tenant's modules, and the
        # tenant ids to move them on.
        api.token = api.login(phase_a.ADMIN)
        phase_f.run(api, rep, sold, tenants)

    if "g" in want:
        phase_g.run(api, rep, sold)

    if "h" in want:
        phase_h.run(api, rep, sold)

    if "i" in want:
        phase_i.run(api, rep, sold, tenants)

    if "j" in want:
        phase_j.run(api, rep, sold)

    if "k" in want:
        phase_k.run(api, rep, sold)

    if "l" in want:
        phase_l.run(api, rep, sold)

    if "m" in want:
        phase_m.run(api, rep, sold)

    return rep.summary()


if __name__ == "__main__":
    raise SystemExit(main())
