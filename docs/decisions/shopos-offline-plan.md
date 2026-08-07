---
name: shopos-offline-plan
description: Offline POS module architecture + phased build steps (Phase 0 bug-fix gate → PWA → catalog → sync)
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-21T18:06:16.441Z
---

Offline POS plan from the 2026-07-21 audit. Today NOTHING offline exists: no PWA/service worker/cached catalog/sales queue; backend has no offline auth or sync path (Sanctum + ResolveTenant hit DB every request; every scan + checkout is live). `Modules.php:17` falsely advertises "Works offline."

**Principles:** (1) offline is POS-only, rest of panel stays online; (2) server stays source of truth — offline sales are PROVISIONAL, client prices for receipt but server RECOMPUTES on sync (preserves server-authoritative guarantee); (3) replay-safe — every offline sale carries UUID+deviceId idempotency key, stock moves as commutative in/out deltas, never `set` offline.

**Frontend structure — `src/modules/offline/`:** db/schema.ts (IndexedDB: catalog, barcodeIndex, settings, coupons, salesQueue, shiftLog, syncMeta), db/catalogRepo.ts, db/queueRepo.ts, sync/bootstrap.ts, sync/flusher.ts, sync/connectivity.ts, pricing/priceLine.ts (MIRROR of server pricing — parity-tested), pricing/receipt.ts, lookup/barcodeIndex.ts, lookup/scaleBarcode.ts (PORT of backend ScaleBarcode.php), hooks/useOfflineCheckout.ts, store/offlineStore.ts.

**Backend additions:** `GET /pos/bootstrap` (one-call catalog+settings+shift+coupons snapshot, delta-since); `POST /pos/sync` (batch-ingest offline sales, idempotent, accept client sold_at + provisional receipt no, oversell→BACKORDER not reject); offline-auth decision (long-lived device token vs 60-min access token — IssueTokensAction).

**Phased steps:**
- Phase 0 — Stabilize backend: fix all P0 bugs in [[shopos-audit-backlog]] + idempotency catch-unique-return-existing + tax/discount server-authority + tests. MUST precede offline (replays corrupt stock otherwise).
- Phase 1 — PWA shell + warm cache (zero behavior change, ship first): vite-plugin-pwa + manifest + ErrorBoundary around Suspense + React Query IndexedDB persister + POS cart persistence + real navigator.onLine pill (replace hardcoded one at PosPage.tsx:874) + wire useMe() on boot.
- Phase 2 — Offline catalog + local lookup: /pos/bootstrap + hydration; port ScaleBarcode→TS; PosPage.scan() resolves local barcode index first; priceLine.ts with golden-fixture parity tests vs backend.
- Phase 3 — Offline sales queue + sync: POST /pos/sync; queue on network fail; provisional receipt; reconcile server INV- on flush; conflict surfacing; offline shift reconciliation.
- Phase 4 — Hardening: coupon offline policy; multi-terminal conflict tests; oversell review queue; sync-status UI; finalize device-token policy.
