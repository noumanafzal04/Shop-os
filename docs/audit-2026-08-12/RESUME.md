# Business-Type Gap Audit — resume instructions

**Status:** not started (first attempt lost to a session limit — see *What went wrong*).
**Question being answered:** every business type has its own fields and its own data, and ShopOS was built that way — so what is MISSING, backend + admin panel, A-Z?

Scope is **backend + admin/tenant panel only**. `shopos-mobile` is explicitly out of scope.

---

## How to run it

The audit is batched on purpose. Run a few areas at a time; each agent writes
its own markdown file to `docs/audit-2026-08-12/findings/<key>.md` **before**
returning, so a session limit can never wipe completed work again.

```
Workflow({
  scriptPath: 'docs/audit-2026-08-12/gap-audit.workflow.js',
  args: ['pharmacy', 'retail', 'food']
})
```

**Area keys (12 total):**

| Trades | Cross-cutting |
|---|---|
| `food` `mart` `pharmacy` `retail` | `gating` — backend vs frontend trade gating |
| `services` `automotive` `petroleum` `finance` | `schema` — per-trade column/table coverage |
| | `panel` — API field vs UI field parity |
| | `drift` — duplicated sources of truth |

Suggested batches of 3 (roughly one batch per session window):

1. `['pharmacy','retail','food']` — deepest trades, most existing code
2. `['mart','automotive','petroleum']`
3. `['services','finance','gating']` — services & finance are the likely thin ones
4. `['schema','panel','drift']` — cross-cutting, best run once trades are known

When all 12 files exist in `findings/`:

```
Workflow({ scriptPath: 'docs/audit-2026-08-12/gap-audit.workflow.js', args: ['SYNTHESIZE'] })
```

That writes `docs/audit-2026-08-12/GAP-REPORT.md` and lists which areas it
covered — so a partial synthesis is still honest about its own coverage.

**Check progress at any time:** `ls docs/audit-2026-08-12/findings/`

---

## What went wrong the first time (2026-08-12, ~21:10 PKT)

Run `wf_63a0015b-c62` fired all 12 auditors + synthesis in one shot with no
intermediate persistence. It hit the account session limit after ~6 minutes:

- 13/13 agents errored, 0 completed
- 952k subagent tokens, 470 tool uses burned
- 6 trade auditors (food, mart, pharmacy, retail, services, automotive) had each
  done 65–93 tool calls of real reading — **all of it unrecoverable**, because
  they died before emitting their structured output
- 6 others never got a single tool call away

`resumeFromRunId` was useless: it replays *completed* agents from cache, and
none completed. Nothing to resume from.

**The two fixes now in the script:**

1. **Durability** — every agent must `Write` its findings file before returning.
   The prompt says so explicitly, including "if you are running low on room,
   write the file with whatever you have rather than returning nothing."
2. **Batching** — `args` selects which areas run, so a limit costs one batch
   instead of the whole audit.

---

## Design notes worth keeping

- Each finding goes through an **adversarial verifier** whose job is to *refute*
  it. The commonest failure mode is claiming something is missing when it exists
  somewhere the first agent didn't look — so verifiers must grep under three
  plausible names across backend, panel, routes and migrations, and record those
  greps. Precedent: two of three findings in the reorder/labels pass were wrong.
- Verifiers also append a `## Verification` section to the area file marking
  refuted findings, so nobody re-raises them in a later session.
- Findings distinguish three states, and the middle one is usually the cheapest
  value in the whole report: **missing entirely** / **backend exists but no UI**
  / **exists but gated to the wrong trades**.
- No generic ERP wishlist items. Only what a real Pakistani shop of that trade
  hits in ordinary daily operation.

---

## Established architecture (don't re-derive)

- A business type **proposes** modules; it does not grant them. `tenants.features`
  is the authority (`Tenant::featureEnabled`), set by the admin at creation.
  Plans control money and ceilings, never capability.
- Visibility is 4 ANDed layers: tenant isolation (`BelongsToTenant` global scope,
  which makes a leak something you'd have to *write*) → module → trade → person
  (ANY-of permissions via `screenPermissions.ts`).
- `branch_stock` is the stock source of truth; `products.stock_quantity` is a
  denormalised rollup recomputed on every write.
- `InventoryService::adjust()` is the only stock write path.
- The server decides all money; the browser never sends a price or a total.

## One live footgun found while reading (not yet fixed)

`CreateProductAction` builds its insert by naming every column **by hand**, while
`UpdateProductAction` fills the model wholesale. Any new field added to
`StoreProductRequest` that isn't manually added to that insert list will save on
edit but silently vanish on create — and will look like it works, because the
second save fixes it. This already cost `drug_schedule`, `tax_group_id` and
`kitchen_station` once (see the comment at `CreateProductAction.php:64-77`).
Those three are fixed; the shape that caused them is not.
