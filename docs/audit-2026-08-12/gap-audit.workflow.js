export const meta = {
  name: 'shopos-business-type-gap-audit',
  description: 'A-Z gap analysis of ShopOS backend + panel, driven by the 8 business types. Batched + durable: each auditor writes its own markdown file before returning, so a session limit never loses completed work.',
  phases: [
    { title: 'Audit', detail: 'one agent per requested area; each writes docs/audit-2026-08-12/findings/<key>.md' },
    { title: 'Verify', detail: 'adversarial re-check — does the "missing" thing already exist?' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// USAGE
//   Workflow({ scriptPath: '<this file>', args: ['pharmacy','retail','food'] })
//
// args = list of area keys to run THIS batch. Omit to run every area (only do
// that with plenty of quota — the full 12 burned ~950k tokens in 6 minutes and
// hit the session limit).
//
// Keys: food mart pharmacy retail services automotive petroleum finance
//       gating schema panel drift
//
// Each agent writes docs/audit-2026-08-12/findings/<key>.md BEFORE returning,
// so completed areas survive a limit, a crash, or a session reset. Re-running a
// batch overwrites only that batch's files.
//
// When every area has a file, synthesize with:
//   Workflow({ scriptPath: '<this file>', args: ['SYNTHESIZE'] })
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = '/Users/devdimensions/PhpstormProjects/shopos'
const BE = ROOT + '/shopos-backend'
const FE = ROOT + '/shopos-admin-and-user-panel'
const OUT = ROOT + '/docs/audit-2026-08-12/findings'

const GAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'what_exists', 'findings'],
  properties: {
    area: { type: 'string' },
    what_exists: { type: 'string', description: '5-12 sentences: what ShopOS ACTUALLY has for this area today, based on files you read. Name files.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'kind', 'where', 'detail', 'trade_reason', 'evidence'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          kind: { type: 'string', enum: ['missing-field', 'missing-data', 'missing-screen', 'backend-only-no-ui', 'ui-only-no-backend', 'wrong-gating', 'bug', 'inconsistency'] },
          where: { type: 'string', description: 'repo-relative path(s), or "NOT PRESENT ANYWHERE" plus the greps that prove it' },
          detail: { type: 'string' },
          trade_reason: { type: 'string', description: 'a real operational scenario in a Pakistani shop of this trade' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'confirmed', 'reason', 'corrected_severity'],
        properties: {
          title: { type: 'string' },
          confirmed: { type: 'boolean' },
          reason: { type: 'string' },
          corrected_severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3', 'already-exists', 'not-needed'] },
        },
      },
    },
  },
}

const COMMON = `
You are auditing ShopOS at ${ROOT}.
Backend (Laravel, PHP, UUID keys, multi-tenant): ${BE}
Admin + tenant panel (React + TS + Vite + react-query + Tailwind): ${FE}
IGNORE ${ROOT}/shopos-mobile — the customer mobile app is OUT OF SCOPE.

ORIENT YOURSELF FIRST:
- ${BE}/app/Support/BusinessTypes.php   (8 primary + 9 legacy types: default features, seed categories, units, variant attributes, item types)
- ${BE}/app/Support/Modules.php         (module registry + dependency graph)
- ${BE}/app/Support/ItemTypes.php       (item_type capability matrix)
- ${ROOT}/MODULE-GUIDE.md               (screen-by-screen manual, incl. "what changes per trade")
- ${ROOT}/BUSINESS-TYPE-WORKFLOWS.md    (developer contract: modules, gating, tests)
- ${ROOT}/BUSINESS-FLOWS.md             (who gets which screen, daily loop per trade)

ARCHITECTURE FACTS (established — don't re-derive, but verify if a finding depends on one):
- A business type PROPOSES modules; it does not grant them. The tenant's own \`tenants.features\` map is the authority (Tenant::featureEnabled), set by the admin at creation.
- Visibility = 4 ANDed layers: tenant isolation (BelongsToTenant global scope) → module (features map) → trade (business_type) → person (permissions, ANY-of via ${FE}/src/common/routing/screenPermissions.ts).
- branch_stock is the stock source of truth; products.stock_quantity is a denormalised rollup.
- InventoryService::adjust() is the ONLY stock write path.
- The server decides all money; the browser never sends a price or total.

RULES:
- READ the files. Every claim backed by code you opened or a grep you ran.
- Before claiming something is MISSING you must GREP FOR IT under at least three plausible names — backend, panel, migrations, routes/api.php — and put those greps in \`evidence\`. Features hide here (a reorder list once existed but was unreachable).
- Paths RELATIVE to ${ROOT}.
- Distinguish: (a) missing entirely, (b) backend exists but no UI, (c) exists but gated to the wrong trades.
- No generic ERP wishlist items. Only what a real Pakistani shop of this trade hits in ordinary daily operation.
- An empty findings list is valid and respected. 4 real gaps beat 20 speculative ones.

⚠️ DURABILITY REQUIREMENT — do this BEFORE you return:
Write your complete findings as markdown to \`${OUT}/<AREA_KEY>.md\` using the Write tool.
Include: what exists today, then every finding with severity, kind, where, detail, trade reason and evidence.
A previous run of this audit lost 950k tokens of completed analysis because agents returned without persisting. Write the file first, then return the structured object. If you are running low on room, write the file with whatever you have rather than returning nothing.
`

const TRADES = {
  food: { title: 'FOOD & RESTAURANT', brief: `Type \`food\` (legacy \`restaurant\`). Categories: restaurant, fast_food, cafe, bakery, cloud_kitchen, juice_corner, home_kitchen. Defaults: products ON, inventory OFF, marketplace ON, delivery ON, dine_in ON, services OFF. Item types: food_item, physical_product, deal.

Read: dine-in (DiningTable, RestaurantTicket, KitchenTicket, tabs, KOT, split settle), ModifierGroup/ModifierOption, RecipeItem + SyncRecipeItemsAction, available_from/until menu hours, kitchen_station routing, ${FE}/src/modules/dinein, ${FE}/src/modules/kitchen.

Judge daily needs: day-part menus, modifier pricing + required/max-choice rules, half/full plate portions, combo maths, KOT to multiple stations, table transfer & merge, waiter tab ownership, split bill by item, service charge/tip, dine-in vs takeaway vs delivery pricing, packaging charges, recipe depletion + wastage, ingredient purchasing, 86'ing an item (daily availability toggle), order-type-wise tax, aggregator order reconciliation.` },

  mart: { title: 'MART & GROCERY', brief: `Type \`mart\` (legacy \`grocery\`). Categories: grocery, supermarket, general_store, mini_mart, convenience_store, dairy_shop. Defaults: products, inventory, marketplace, delivery ON.

Read: sold_by unit|weight, plu_code + scaleLookup in PosController, ProductUnit pack-breaking (factor), ProductBarcode, batches/expiry, StockCount, reorder list, BOGO/promotions, customer groups, tax groups.

Judge daily needs: loose weighing + scale-label barcodes, pack-breaking (carton→dozen→piece) stock maths, per-kg vs per-piece pricing, near-expiry + spoilage/wastage recording for dairy & bakery, supplier-wise rate lists and rate changes, MRP vs selling price, crate/bottle deposit returns, short-expiry markdown, multi-barcode same item, shelf label printing, fast-moving reorder suggestions, khata for regulars, home-delivery order picking.` },

  pharmacy: { title: 'PHARMACY & MEDICAL', brief: `Type \`pharmacy\` (legacy \`clinic\`). Categories: medical_store, surgical, homeopathic, clinic_pharmacy. Defaults: products, inventory, delivery ON; marketplace OFF. Item types: medicine, physical_product. Fields: generic_name, strength, dosage_form, drug_schedule, batch+expiry REQUIRED.

Read: ProductBatch + expiry engine, FEFO in InventoryService, the expired-stock fence, requires_prescription + Rx capture, PharmacyController, near-expiry dashboard counts, medicine variants + per-variant batches, opening batch on create.

Judge daily needs: salt/generic substitution search at the counter, strip vs tablet vs box unit conversion, batch-wise purchase rate + MRP, near-expiry return-to-supplier with credit note, expired write-off accounting, controlled/schedule drug register + statutory reporting, prescription retention + doctor-wise records, refrigerated items, recall by batch (who got the bad lot), narcotics register, chronic-med minimum stock, partial-strip selling, dosage printed on label.` },

  retail: { title: 'RETAIL STORE', brief: `Type \`retail\` (legacy wholesale, books, hardware). Categories incl. garments, footwear, electronics, mobile_accessories, cosmetics, jewellery, hardware, wholesale. Defaults: products, inventory, marketplace, reservations, delivery ON.

Read: ProductSerial + SaleItemSerial + serial_inventory migration, WarrantyController + WarrantyClaim, ProductVariant, wholesale_price + price_tiers, customer groups, promotions/BOGO/coupons.

Judge daily needs: size-colour variant MATRIX entry (not one-by-one), barcode per variant, serial capture on RECEIVE not only on sale, per-serial returns, warranty claim against the exact unit, IMEI lookup, exchange/replacement (not just refund), article/style/design code, season + stock ageing, wholesale vs retail price level per customer, quantity breaks, gift receipts, alterations (garments), jewellery weight + making charges (it is a listed category — check it is actually served), goods cut from a roll by length/weight, layaway/advance booking.` },

  services: { title: 'SERVICES', brief: `Type \`services\` (legacy salon, service). Categories: salon_beauty, barber, spa, mobile_repair, computer_repair, auto_workshop (labour only), tailor, laundry, printing, photography, clinic, other. Defaults: services ON; products, inventory, marketplace, reservations OFF. Item type: service only. Field: duration_minutes.
NOTE: BusinessTypes.php says reservations stay OFF because the reservation engine holds PRODUCT stock and cannot book appointments — an appointments add-on is described as future work.

Read: the service item path (track_inventory prohibited), duration_minutes, ReservationService, StaffController + job presets.

Judge daily needs: APPOINTMENT booking with a time slot and a staff member (establish exactly what is absent and what a minimum version needs), staff-wise service commission, chair/bay capacity, repair job tracking (device in → diagnosis → parts → ready → delivered), customer's device/garment held on premises + its token receipt, estimate vs final bill approval, parts consumed on a job, prepaid packages (10 haircuts), turnaround promises, before/after photos.` },

  automotive: { title: 'AUTO & TYRE', brief: `Type \`automotive\` (legacy \`workshop\`). Categories: tyre_shop, battery_shop, auto_parts, auto_workshop, oil_change, denting_painting, ac_service, car_wash, bike_workshop. Defaults: products, services, inventory ON; marketplace/delivery OFF. Goods AND labour on one invoice.

Read: CustomerVehicle, VehicleController, SaleTradeIn (a trade-in is a TENDER not a discount), DOT tyre dating, ${FE}/src/modules/vehicles, warranty.

Judge daily needs: vehicle registration + make/model/year + service history, odometer + next-service-due reminder, job card (vehicle in → work items → parts → labour → out), parts + labour on one invoice with different tax treatment, mechanic-wise labour allocation + commission, tyre size matrix + DOT week/year age at sale, battery warranty months from sale with pro-rata claim, old battery/tyre buy-back as trade-in tender, oil change interval per vehicle, fitment charges, alignment/balancing as billable services, reminder SMS, estimate approval before work.` },

  petroleum: { title: 'PETROLEUM & ENERGY', brief: `Type \`petroleum\`. Categories: petrol_pump, cng_station, diesel_station, lubricants_shop, tyre_shop, auto_service, car_wash. Defaults: products, services, inventory, fuel ON. \`fuel\` depends on products + inventory.

Read ALL of: FuelTank, FuelPump, FuelNozzle, FuelPriceChange, FuelDelivery, ForecourtShift, ForecourtReading, ForecourtDip, ForecourtShiftController, FuelSetupController, FuelPriceController, FuelDeliveryController, RecordFuelDeliveryAction, CloseForecourtShiftAction, ${FE}/src/modules/fuel.

Judge daily needs: nozzle meter opening/closing per shift, tank dip vs book stock reconciliation + allowed variance, test litres returned to tank, meter roll-over, mid-shift government price change and in-flight sales, density/temperature correction, tanker delivery invoice vs actual dip gain/loss, evaporation allowance, credit/fleet accounts buying all month, attendant-wise sales + shortage recovery, lubricants alongside fuel, forecourt mart as a separate register, OGRA/DRS statutory reporting, per-nozzle totalizer audit.` },

  finance: { title: 'FINANCE MANAGER (books-only)', brief: `Type \`finance\`. Categories: office, agency, software_house, freelancer, consultant, school, clinic, ngo, trader, home_business. Defaults: expenses ONLY — products, services, inventory, marketplace, reservations, delivery, dine_in, pos, images ALL OFF. itemTypesFor returns [] (no item types at all).

Read: Expense, ExpenseCategory, ExpenseBudget, RecurringExpense, Income, IncomeCategory, LedgerService, Cashbook/Ledger reports, ${FE}/src/modules/expenses, ${FE}/src/modules/income, plus every screen a finance tenant lands on.

CRITICAL ANGLE: this is the only type with NO catalog, NO POS, NO stock. Walk the whole panel as a finance tenant and find every screen, dashboard tile, report, quick-action, setup step, sidebar entry or empty state that ASSUMES a catalog/POS/stock exists. Those are real breakages. Verify against the gating code (${FE}/src/common/routing, ${FE}/src/common/tenant/businessType.ts, the layout/sidebar) rather than guessing.

Also judge: can a finance tenant bill anyone AT ALL (invoicing)? receivables/payables ageing, bank vs cash accounts, P&L with period comparison, tax/withholding, receipt attachments, approval flow, year-end close, accountant export.` },
}

const CROSS = {
  gating: { title: 'BUSINESS-TYPE GATING CONSISTENCY', brief: `Backend vs frontend trade gating — the highest-value cross-cutting check.

Backend: grep \`business_type\`, \`BusinessTypes::\`, \`primary(\`, \`itemTypesFor\`, \`featureEnabled\`, \`moduleMap\`, module middleware in ${BE}/routes/api.php, plus any policy fencing a trade-specific route.
Frontend: ${FE}/src/common/tenant/businessType.ts, ${FE}/src/common/routing/guards.tsx, screenPermissions.ts, adminScreenPermissions.ts, the sidebar in ${FE}/src/layout, and every place the panel branches on business type or a feature flag.

Find, with file:line on BOTH sides:
1. Gated on the FRONTEND but not the BACKEND — the API is reachable by a trade that should not have it.
2. Gated on the BACKEND but the frontend still offers the screen — user clicks, gets 403/blank.
3. Gated by comparing against a HARDCODED list of type codes instead of BusinessTypes::primary() — legacy tenants (restaurant, grocery, clinic, salon, workshop, service, wholesale, books, hardware) silently lose the feature. BusinessTypes.php:73-92 documents this exact class as fixed once; find every place it can still occur.
4. A gate reading the TYPE'S TEMPLATE features instead of the tenant's live \`features\` map (itemTypesFor's docblock documents this defect; find remaining instances).
5. Trade-specific screens with NO gating at all.
Enumerate every trade-specific surface and state how it is gated on each side.` },

  schema: { title: 'SCHEMA-LEVEL FIELD COVERAGE PER TRADE', brief: `Run \`ls ${BE}/database/migrations\` (93 files) and read every migration adding trade-specific columns or tables. Build a complete map: which columns/tables serve which trade.

Locate and verify (don't assume): generic_name, strength, dosage_form, drug_schedule, requires_prescription, product_batches+expiry (pharmacy); plu_code, sold_by, product_units/factor, product_barcodes (mart); tracks_serial, warranty_months, product_serials, sale_item_serials, warranty_claims (retail); available_from/until, kitchen_station, recipe_items, modifier_groups/options, dining_tables, restaurant_tickets, kitchen_tickets (food); duration_minutes (services); customer_vehicles, sale_trade_ins (automotive); fuel_* and forecourt_* (petroleum); expenses/incomes/budgets/recurring (finance).

Judge:
1. Which trade has the THINNEST schema — a type entry with almost no columns or tables of its own? QUANTIFY (count columns + tables per trade). A trade "supported" only by a features map and a category list is the core gap.
2. Trade-specific columns on \`products\` that are not nullable-safe for other trades, or missing an index their trade's hot query needs (medicine by generic_name at the counter, serial lookup, PLU scan).
3. Trade-specific tables lacking tenant_id or branch_id, or with a unique constraint that is global instead of per-tenant.
4. Columns written nowhere or read nowhere (grep before claiming).
5. Data a trade must record daily that the schema cannot hold at all.` },

  panel: { title: 'PANEL UI FIELD PARITY', brief: `The "backend-only-no-ui" hunt — most likely place large gaps hide.

Read in full: ${FE}/src/modules/catalog/pages/ProductFormPage.tsx (~1413 lines), ProductsPage.tsx, ProductEditorRoute.tsx, hooks/useCatalog.ts, services/catalogService.ts, ${FE}/src/common/types, ${FE}/src/common/tenant/businessType.ts.
Then: ${BE}/app/Http/Requests/Catalog/StoreProductRequest.php, UpdateProductRequest.php, ${BE}/app/Actions/Catalog/CreateProductAction.php, UpdateProductAction.php.

Produce a FIELD PARITY TABLE, then the gaps:
1. Every field the API accepts vs whether the form exposes it and under which trade. Name every field NO UI can set.
2. Trade-specific fields shown to the WRONG trades, or hidden from a trade that needs them.
3. Nested collections — variants, barcodes, units, combo_items, recipe_items, modifier groups, images, collections, branch prices, batches, serials: for EACH, can the user create, edit AND delete from the UI? Add-but-not-remove is a real gap.
4. CreateProductAction names its insert columns by hand while UpdateProductAction fills wholesale. Diff the CURRENT insert list against the CURRENT StoreProductRequest rules and report any field validated + accepted but never written on create (this previously hit drug_schedule, tax_group_id, kitchen_station — check TODAY's state).
5. Trade module UIs — ${FE}/src/modules/{pharmacy,dinein,kitchen,fuel,vehicles,warranty,stocktake,transfers,inventory,purchases,promotions}: complete, or read-only where a write is needed?` },

  drift: { title: 'THE DRIFT PATTERN', brief: `This codebase's recurring bug class: a duplicated source of truth whose copies fall out of step. Several are DOCUMENTED IN COMMENTS as already fixed:
- \`tenants.features\` vs the \`online_shop_enabled\` column (${BE}/app/Models/Tenant.php:279)
- sidebar permission filter vs dashboard tiles (${FE}/src/common/routing/screenPermissions.ts:1-31)
- CreateProductAction hand-named insert vs UpdateProductAction wholesale fill (${BE}/app/Actions/Catalog/CreateProductAction.php:64-77)
- BusinessTypes template features vs tenant live features (${BE}/app/Support/BusinessTypes.php:505-510)
- products.stock_quantity rollup vs branch_stock truth (${BE}/app/Services/InventoryService.php:212-219)

FIND THE ONES NOT YET FIXED:
1. Other denormalised columns copying a value that lives elsewhere — grep migrations for cached counts, mirrored booleans, snapshotted names/prices — and check EVERY write path keeps them in step. Name the paths you checked.
2. Any list of permissions, modules, business types, item types or screens written out MORE THAN ONCE (backend + frontend, or two frontend files). Check the copies are identical TODAY; report any that already differ.
3. Enum-ish strings duplicated across a migration, a PHP constant and a TS union — report any where the three sets differ.
4. Money or tax computed in more than one place (POS vs online order vs sale document vs reports) — check the results agree.
5. Permission strings used in the frontend that don't exist in the backend registry, or vice versa. Enumerate both sets and diff them.
Report each drift with BOTH file:line locations and what breaks when they disagree.` },
}

const ALL = { ...TRADES, ...CROSS }
const requested = Array.isArray(args) && args.length ? args : Object.keys(ALL)

// ── Synthesis mode ───────────────────────────────────────────────────────────
if (requested.length === 1 && requested[0] === 'SYNTHESIZE') {
  phase('Audit')
  const report = await agent(
    `${COMMON}

You are the SYNTHESIZER. Read EVERY markdown file in ${OUT}/ — one per audited area (8 business types + 4 cross-cutting readers). Each already survived an adversarial verification pass that tried to prove the "missing" feature already exists.

The user's question: each business has its own fields and its own data, and the system was built with that in mind — so what is MISSING, backend and frontend, A-Z?

Write the report to ${ROOT}/docs/audit-2026-08-12/GAP-REPORT.md with this structure:

# ShopOS — Business-Type Gap Analysis

## 1. Verdict in five lines
How complete is the business-type engine really? Which trades are served end to end, which are a type entry with little behind it. Blunt and specific.

## 2. Depth-per-trade scorecard
Table, one row per trade (Food, Mart, Pharmacy, Retail, Services, Automotive, Petroleum, Finance). Columns: Own tables/columns, Own screens, Depth (Deep/Workable/Shallow/Name-only), Biggest single gap. Rank deepest → shallowest.

## 3. P0 — the shop cannot run its day
Grouped by trade. Each: what's missing, path or "not present anywhere", the daily scenario that breaks, one-line fix direction. No P0s? Say so.

## 4. P1 — painful weekly workarounds
Same shape, three lines each.

## 5. Cross-cutting structural issues
Gating mismatches, schema coverage, panel parity, drift. Order by blast radius.

## 6. What already exists that nobody can reach
Every backend-only-no-ui finding across all areas. Usually the cheapest value in the report.

## 7. Build order
Ordered, highest value first. Each: what it unlocks, rough size, which trades it serves. Multi-trade work ahead of single-trade work of similar size.

RULES: cite real paths. Never invent a gap absent from the files. Never pad — a clean area is reported clean. Don't soften a P0. Don't repeat a refuted item as a gap.

Also note in a final "## Coverage" section which area files were present and which were missing, so the reader knows what this report does and does not cover.

After writing the file, return a 15-line executive summary as your text output.`,
    { label: 'synthesize', phase: 'Audit', effort: 'high' }
  )
  return { mode: 'synthesize', report }
}

// ── Audit mode ───────────────────────────────────────────────────────────────
const areas = requested.filter((k) => ALL[k])
const unknown = requested.filter((k) => !ALL[k])
if (unknown.length) log(`⚠️ unknown area keys ignored: ${unknown.join(', ')}`)
log(`Auditing ${areas.length} area(s): ${areas.join(', ')} → ${OUT}/<key>.md`)

phase('Audit')

const results = await pipeline(
  areas,
  (key) =>
    agent(
      `${COMMON}
YOUR AREA KEY: \`${key}\`  → write your file to ${OUT}/${key}.md
YOUR AREA: ${ALL[key].title}

${ALL[key].brief}

METHOD, in order:
1. Read the orientation files, especially this area's own code.
2. Find everything that ALREADY serves this area and write it into \`what_exists\` — specific, naming files. Do this BEFORE hunting gaps or you will report things that exist.
3. Now judge each daily need above: exists and works / backend exists but no UI / exists but wrongly gated / missing entirely. Only the last three are findings.
4. Add anything genuinely needed that my list omits — my list is a starting point, not a boundary.
5. Severity honestly: P0 = the shop cannot run its day; P1 = hit weekly with a painful workaround; P2 = real but occasional; P3 = polish.

GREP BEFORE CLAIMING ABSENT, and put the greps in \`evidence\`.
WRITE ${OUT}/${key}.md BEFORE RETURNING.`,
      { label: `audit:${key}`, phase: 'Audit', schema: GAP_SCHEMA }
    ),
  (res, key) => {
    if (!res || !res.findings || res.findings.length === 0) return { area: key, map: res, confirmed: [], refuted: [] }
    const list = res.findings
      .map((f, i) => `${i + 1}. [${f.severity}/${f.kind}] "${f.title}"\n   where: ${f.where}\n   claim: ${f.detail}\n   trade reason: ${f.trade_reason}\n   claimed evidence: ${f.evidence}`)
      .join('\n\n')
    return agent(
      `${COMMON}
You are an ADVERSARIAL VERIFIER for area \`${key}\`. Another agent claims the gaps below. REFUTE them.

The commonest way these are WRONG is that the thing ALREADY EXISTS where the other agent didn't look. For EACH finding:
- Grep the backend under at least THREE plausible names, then the panel, then routes/api.php, then the migrations. Say which greps you ran.
- Open the named files and read them yourself. Don't trust the quoted evidence.
- Exists but unreachable from the UI is NOT "already-exists" — confirm it as backend-only-no-ui and say so.
- A generic ERP wishlist item rather than a real daily need → corrected_severity='not-needed'.
- Default to confirmed=false when you cannot personally establish the absence.
- Downgrade aggressively. A P0 must genuinely stop the shop's day.
- The reason MUST name a file:line you read, or the exact greps that returned nothing.

FINDINGS:

${list}

Then UPDATE ${OUT}/${key}.md: append a "## Verification" section recording each verdict, and mark refuted findings clearly so nobody re-raises them. Do this BEFORE returning.

Return one verdict per finding, copying each title EXACTLY.`,
      { label: `verify:${key}`, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' }
    ).then((v) => {
      const byTitle = new Map((v?.verdicts || []).map((x) => [x.title, x]))
      const confirmed = []
      const refuted = []
      for (const f of res.findings) {
        const verdict = byTitle.get(f.title)
        const dead = !verdict || !verdict.confirmed || verdict.corrected_severity === 'already-exists' || verdict.corrected_severity === 'not-needed'
        if (dead) refuted.push({ ...f, verify_reason: verdict?.reason || 'no verdict', outcome: verdict?.corrected_severity || 'unverified' })
        else confirmed.push({ ...f, severity: verdict.corrected_severity || f.severity, verify_reason: verdict.reason })
      }
      return { area: key, map: res, confirmed, refuted }
    })
  }
)

const ok = results.filter(Boolean)
const allConfirmed = ok.flatMap((r) => r.confirmed)
log(`${ok.length}/${areas.length} areas done. ${allConfirmed.length} gaps confirmed. Files in ${OUT}/`)

return {
  mode: 'audit',
  ran: areas,
  perArea: Object.fromEntries(ok.map((r) => [r.area, { confirmed: r.confirmed.length, refuted: r.refuted.length }])),
  P0: allConfirmed.filter((f) => f.severity === 'P0').map((f) => `[${f.area || ''}] ${f.title} — ${f.where}`),
  P1: allConfirmed.filter((f) => f.severity === 'P1').map((f) => `[${f.area || ''}] ${f.title} — ${f.where}`),
  note: `Per-area markdown in ${OUT}/. When all 12 exist, run with args:['SYNTHESIZE'].`,
}
