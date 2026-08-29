"""
The sweep, checked against itself, before it is allowed to check the product.

Runs in milliseconds as a preflight in `run.py`. It exists because of a run
that stopped on this:

    BUG  A   at least one plan exists — no plan means no tenant can be created

against a database holding four active plans. `throttle:auth` is 5/min per IP
and this sweep drives about a hundred identities, so the sign-in was refused,
`Api.call` returned its "never asked" sentinel — with the words *this is not an
answer about the product* inside the envelope — and the phase read the empty
body and filed a defect.

The harness knew. It was the layer above that threw the knowledge away, and it
could do so in **325 places**: every `rep.bug` call across 21 phases, none of
which looks at the status first. So the guard is in `Report._add`, and this is
what proves it.

    python3 harness_test.py
"""

import sys

from api import Api, Report


def run() -> list[str]:
    fails: list[str] = []

    # 1. Blind: a verdict reached without an answer is not a verdict.
    api = Api()
    api.blind = "no token for GET /admin/plans — the sign-in failed"
    rep = Report(api, quiet=True)
    rep.bug("A", "at least one plan exists", "no plan means no tenant can be created")

    if [r[0] for r in rep.rows] != ["QUERY"]:
        fails.append(f"a blinded bug was filed as {[r[0] for r in rep.rows]}, expected QUERY")
    if rep.blinded != 1:
        fails.append(f"blinded counter is {rep.blinded}, expected 1")
    if "HARNESS" not in rep.rows[0][3]:
        fails.append("the downgraded row does not say the harness was blind")

    # 2. THE DENOMINATOR. A guard that suppresses everything would satisfy the
    #    check above and destroy the sweep. With sight restored, a real defect
    #    must still be reported as one.
    api.blind = None
    sighted = Report(api, quiet=True)
    sighted.bug("A", "a plan renders a dollar sign", "Basic")
    if [r[0] for r in sighted.rows] != ["BUG"]:
        fails.append("a real bug was suppressed — the guard is too wide")
    if sighted.blinded != 0:
        fails.append("a sighted run counted a blinded check")

    # 3. An incomplete run must not look like a clean one.
    if rep.summary() == 0:
        fails.append("a blinded run returned 0 — an unasked check is not a pass")

    return fails


if __name__ == "__main__":
    problems = run()
    for p in problems:
        print(f"  HARNESS BROKEN: {p}")
    print("harness self-check: " + ("FAILED" if problems else "ok"))
    sys.exit(1 if problems else 0)
