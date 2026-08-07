---
name: shopos-pharmacy-edges
description: "Pharmacy/MEDICAL edge-case coverage — batch+expiry engine done (FEFO, expired-fence, near-expiry surface); expiry now REQUIRED for medicine batches; remaining pharmacy gaps"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-29T09:41:49.966Z
---

MEDICAL is one of the 3 daily-revenue business types ([[shopos-business-priority]]) — cover its edge cases first.

**Already shipped (pre-2026-07-29):** `product_batches` (+ variant_id, branch_id), `ProductBatch` model with `scopeExpiringWithin($days)`; `BatchController` (index/store/update/destroy + `expiring`); InventoryService does FEFO depletion + an EXPIRED-STOCK FENCE (can't sell stock sitting in expired lots) + undated-lots-deplete-last. Rx capture at POS (soft) / hard-block online. Panel `src/modules/inventory/` has full batch manager + an "Expiring stock (30d)" alert card + `useExpiring`.

**2026-07-29 — expiry hardening SHIPPED (backend 620 tests green +2 in PharmacyEdgeCasesTest; panel tsc+build clean):**
- `Product::requiresExpiry()` = item_type === 'medicine'. `BatchController@store` makes `expiry_date` REQUIRED for medicine lots (msg "An expiry date is required for medicine batches."); `@update` won't let a medicine lot's expiry be cleared to null. Presence only (past dates still allowed — logging an already-expired lot to then remove it is valid).
- Dashboard gained `expiring_soon_count` (batches expiringWithin(30) incl. expired, BRANCH-SCOPED via [[shopos-multi-branch]] Phase 4b). Panel ShopDashboard shows an "Expiring Soon" card (Advanced, when >0); InventoryPage batch modal marks Expiry required (asterisk + disabled Add) for medicines.
- TEST GOTCHA fixed: the FEFO "undated lots deplete last" test now uses a physical_product (undated lots are only valid for non-medicine perishables; medicines require expiry). Live-verified on tenant3 (MediPlus): medicine batch w/o expiry→422, with→201, dashboard count=5.

**2026-07-29 (later) — opening-stock + PO expiry leak CLOSED (backend 623 tests green +2; panel tsc+build clean).** Every medicine stock-IN path now forces an expiry: (1) product-create opening stock — `expiry_date` was never even validated so opening lots were ALWAYS undated; StoreProductRequest now `Rule::requiredIf(medicine && (stock_quantity>0 || any variant stock>0))`, CreateProductAction dates both product- AND variant-level OPENING lots (variant lots previously hardcoded null); (2) PO receipt — ReceivePurchaseOrderAction throws `EXPIRY_REQUIRED` (422) if a medicine line is received with no `expiry_date` (nothing moves). Batch endpoint was already enforced. Panel: ProductFormPage shows an "Opening batch expiry" date input for new medicines (asterisk when stock>0) + a `needsExpiry` guard disables Save with a footer hint. Tests: PharmacyEdgeCasesTest (opening-stock 422/201), PurchasingTest (PO receive 422 then 201). REMAINING leak: CSV bulk import of medicine stock uses InventoryService 'set' and creates NO batch at all (no expiry captured) — bulk path, needs an expiry column; deferred.
- Dosage/strength structured field on medicine products (currently only generic_name/brand + requires_prescription).
- Batch RECALL (pull a specific batch_number from sellable stock across branches, audit trail).
- Near-expiry NOTIFICATION (mirror the low-stock Notification dedupe path in InventoryService) — currently visibility only, no push/alert record.
