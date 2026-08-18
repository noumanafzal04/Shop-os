# QA sweep — findings

Newest first. Each row is reproducible from the call recorded beside it.

**Three levels.** `BUG` is a defect. `QUERY` is behaviour that differed from the
sweep's expectation and needs a human decision — **about half of these turn out
to be correct behaviour nobody had written down**, and finding those is worth as
much as finding a defect. `HARNESS` is the sweep itself being wrong, kept
because a harness bug that looks like a product bug is the most expensive kind.

---

## 2026-08-18 — first run

### Phase A · admin side — clean

8 tenants created, one per primary business type, each on the Basic plan.
Every module the type **proposes** arrived granted. No dollar sign anywhere in
the plan payloads.

| | |
|---|---|
| `Sweep Food` … `Sweep Petroleum` | `sweep-<type>@qa.test` / `password` |

### Phase B · per-trade — 2 of 8 completed, 1 query open

| Level | What | Detail |
|---|---|---|
| **QUERY** | `GET /shop/business-type` → **404** | The sweep expected an endpoint serving the trade's units and variant attributes to the shop. It may not exist under that name, or the data may travel inside `/auth/me`. **Needs checking before it is called either way.** |
| HARNESS | 6 of 8 owner logins failed | Login is **throttled**, and the sweep tried eight in one second. Spaced out, every one succeeds. The throttle is correct — the sweep must back off. |
| HARNESS | second run reported 8 "bugs" | "A business with this name already exists" — the console refusing a duplicate, correctly. A sweep that can only run once is a sweep nobody runs. **Fixed:** it now reuses the tenants it made. |
| HARNESS | `/auth/login` takes `identifier` | Not `email` — the field accepts an email **or** a phone, so naming it `email` would be a lie the day a shopkeeper types their number. |
| HARNESS | `/business-types` returns a **list** | Not a map keyed by code. The first version reported all eight types missing, which looked exactly like a product bug. |
| HARNESS | `POST /admin/tenants` needs `plan_id` + nested `owner` | A tenant with no plan has no ceiling and no billing period — a state nobody chose. |

> Four of the six harness findings looked like product bugs on first read. **An
> audit that produces findings is a thing to verify, not to believe.**

### Not yet run

Phases C–H. See [`QA-SWEEP-RUNBOOK.md`](QA-SWEEP-RUNBOOK.md) for the order and
why it is the order.

---

## How to resume

```bash
cd shopos-backend && php artisan serve --port=8000     # if not already up
cd docs/qa/sweep && python3 -c "
import sys; sys.path.insert(0,'.')
from api import Api, Report
import phase_a, phase_b
api, rep = Api(), Report()
rep.summary() if not phase_b.run(api, rep, phase_a.run(api, rep)) else None
"
```

**Next three things, in order:**

1. Add a back-off between logins in `phase_b` (the throttle is correct; the
   sweep must respect it), then complete Phase B for all eight trades.
2. Resolve the `/shop/business-type` 404 — find where a shop is told its trade's
   units and variant attributes, or confirm nothing serves them.
3. Write `phase_c` (selling): open a shift, ring a sale, every tender the trade
   allows, return, void, close the drawer.
