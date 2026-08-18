---
name: shopos-retail-depth
description: "RETAIL vertical depth — serialized selling (IMEI/serial + warranty + lookup) SHIPPED; remaining retail gaps (bulk serial-on-receive, returns-per-serial)"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-16T18:19:44.762Z
---

RETAIL is one of the 5 business types (food/mart/pharmacy/**retail**/services) — the biggest completion gap before this. Serialized selling is the flagship retail feature (phones/electronics/appliances).

**2026-07-29 — serialized selling SHIPPED (backend 632 tests green +9 SerialWarrantyTest; panel tsc+build clean; backend 248b58e, panel 0346fe7):**
- Product flags: `products.tracks_serial` (bool) + `products.warranty_months` (default). `Product::tracksSerial()`. Gated to physical_product in the UI; StoreProductRequest prohibits tracks_serial for service/deal.
- New table `sale_item_serials` (tenant_id, sale_id, sale_item_id, product_id, variant_id, product_name snapshot, serial, warranty_months, warranty_expires_at, sold_at) + index (tenant_id, serial). Model `SaleItemSerial` (BelongsToTenant, `isUnderWarranty()`). Relations: Sale/SaleItem `serials()`.
- POS capture: `items.*.serials[]` + optional `items.*.warranty_months` override on StoreSaleRequest (serials are DATA, never pricing — safe from clients). CreateSaleAction::recordSerials snapshots each serial with warranty_expires_at = sold_at + (override ?? product default).
- GUARDS: serial already out on a LIVE sale (Completed/PartiallyRefunded) → 422 SERIAL_ALREADY_SOLD; a cancelled/refunded sale frees its serials automatically (guard = `whereHas('sale', status in [Completed,PartiallyRefunded])`, no returned_at column needed) so a returned unit resells. serials count > line qty → SERIAL_COUNT_EXCEEDS_QTY. Duplicate serial in one sale → `distinct` rule (422 validation) + SERIAL_DUPLICATE_IN_SALE backstop.
- Warranty desk: `GET /warranty/lookup?serial=` (permission:sales.manage) → product, sold_at, warranty_expires_at, under_warranty, days_left, sale{invoice, status, customer}. 404 SERIAL_NOT_FOUND. WarrantyController.
- Frontend: ProductFormPage "Serial & warranty" section (physical only); PosPage serialized lines show an "IMEI/Serial n/qty" chip → capture modal (one input per unit + warranty override); `/tenant/warranty` WarrantyLookupPage (green/red banner, days-left) linked from sidebar More (POS-enabled); SalesPage sale-detail lists captured serials.

~~**Remaining retail gaps:** capture serials at PO-RECEIVE / opening stock; per-serial RETURN matching; serial on CSV import.~~

**CORRECTED 2026-08-16 — that list went stale.** Verified in source: serials on
PO receive exist (`ReceivePurchaseOrderRequest::receiveMap`) AND are reachable
from `PurchaseOrdersPage`; per-serial returns exist
(`StoreSaleReturnRequest.items.*.serials`) and are reachable from `SalesPage`.
Exchange is also a first-class atomic action (`ProcessExchangeAction`), not
return-then-sell. **Don't re-raise any of these.** This memory being wrong for
18 days is the second time a "remaining" list has silently gone stale — check
the source before trusting one.

**Retail finding 2026-08-16 (audit item 17):** the staff report grouped sales by
who RANG them and the panel called it "Staff performance". Fixed with
`sales.served_by` — see [[shopos-who-sold-it]].

Payment/launch context in [[shopos-payments-status]].
