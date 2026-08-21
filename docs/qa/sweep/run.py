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

import os
import sys

# Run from the sweep's own directory, whatever the caller's is.
#
# Both this and mutate.py import their phases by bare name, so launching them
# from anywhere else fails — and when it failed inside a background job the
# shell had already redirected output, so a STALE log from the previous run sat
# there looking like a fresh result. A green summary that was never produced is
# worse than a crash.
os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.getcwd())

from api import Api, Report  # noqa: E402

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
import phase_s
import phase_t

PHASES = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t"]


# What each phase needs standing before it. Naming a late phase alone runs its
# prerequisites too — asking for "the seams" and silently getting only the admin
# side is the kind of quiet no-op that makes a sweep untrustworthy.
NEEDS = {"a": [], "b": ["a"], "c": ["b"], "d": ["c"], "e": ["c"], "f": ["c"], "g": ["c"], "h": ["c"], "i": ["c"], "j": ["c"], "k": ["c"], "l": ["c"], "m": ["c"], "n": ["c"], "o": ["c"], "p": ["c"], "q": ["c"], "r": ["c"], "s": ["c"], "t": ["c"]}


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


# The module each phase is ABOUT, where that is a single flag. The run uses
# these to say what a phase should have covered and did not — see
# `Report.summary`. Phases whose subject is not one module (the seams, the
# money, the offline queue) simply report what they touched.
GATES = {"i": "pos", "o": "pos", "p": "pos", "q": "pos", "k": "inventory", "s": "inventory", "l": "dine_in", "m": "pos", "n": "pos"}


def _expected(shops: dict, want: set[str]) -> dict[str, set[str]]:
    """For each gated phase in this run, the shops that have its module on."""
    out: dict[str, set[str]] = {}
    for phase, module in GATES.items():
        if phase not in want:
            continue
        out[phase.upper()] = {
            code for code, shop in shops.items()
            if (shop.get("features") or {}).get(module)
        }
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

    if "n" in want:
        phase_n.run(api, rep, sold)

    if "o" in want:
        phase_o.run(api, rep, sold)

    if "p" in want:
        phase_p.run(api, rep, sold)

    if "q" in want:
        phase_q.run(api, rep, sold)

    if "r" in want:
        # `tenants` because phase R needs the ADMIN call that puts a shop on the
        # marketplace — until this phase, no sweep tenant had ever needed to be
        # visible to a shopper.
        phase_r.run(api, rep, sold, tenants)

    if "s" in want:
        # Phase S asks its questions with each shop's OWN token, which `sold`
        # already carries — phase R signed in as a shopper, and a stock question
        # asked with a customer's credentials is a 403 reported as a finding.
        phase_s.run(api, rep, sold)

    if "t" in want:
        # No module gate: every shop has a history, and the trail is not a
        # feature a plan turns on.
        phase_t.run(api, rep, sold)

    code = rep.summary(_expected(shops, want), set(shops))

    # ── was this run trustworthy at all? ────────────────────────────────
    #
    # A call that went out with no credentials is a check that asked as nobody,
    # and the server's 401 is not an answer about the product. One run printed
    # 96 "bugs" that were all this — including "the shop has a Main branch — 0
    # branches" about a shop with eighteen. So it is said out loud, and the run
    # fails: a summary that cannot be trusted must not read like one that can.
    bare = [c for c in api.calls if c.get("error") == "no credentials"]
    if bare:
        print(f"\n{'!' * 70}")
        print(f"{len(bare)} call(s) ran with NO TOKEN — the sweep could not sign in.")
        print("Nothing above is evidence about the product. `throttle:auth` is")
        print("5/min per IP; wait a few minutes and run it again.")
        for c in bare[:5]:
            print(f"  · {c['method']} {c['path']}")
        if len(bare) > 5:
            print(f"  · … and {len(bare) - 5} more")
        print("!" * 70)
        return 1

    return code


if __name__ == "__main__":
    raise SystemExit(main())
