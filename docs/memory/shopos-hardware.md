---
name: shopos-hardware
description: Hardware/peripherals — POS is a WEB/PWA app so the abstraction axis is TRANSPORT not vendor-SDK; hardware_devices registry + receipt-size printing SHIPPED; direct ESC/POS (Web Serial) is the next tier
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-29T11:56:34.903Z
---

**Key architecture fact:** ShopOS POS is a **browser/PWA web app**, so it CANNOT load vendor SDKs (Epson/Zebra/Sunmi). The right abstraction axis is **transport/environment**, NOT brand. Transport tiers: keyboard-wedge scanner (works everywhere, already done) · browser print dialog to an HTML receipt (works everywhere incl. iOS — current default) · direct ESC/POS via Web Serial/WebUSB/Web Bluetooth (Chrome/Edge/Android only, NOT iOS/Firefox — the "pro" fast path, NOT built yet) · native shell bridge (Sunmi/Android WebView or a local print agent — for built-in + LAN printers + iOS, future). Cash drawer = the printer's ESC/POS kick command (rides the printer transport). One `IPrinter` interface, implementations are TRANSPORTS sharing one ESC/POS builder (+ separate ZPL for Zebra labels) — do NOT write per-brand adapter classes. Generic ESC/POS covers ~95% of PK SME hardware (XPrinter/Rongta/Black Copper/Zebra clones).

**2026-07-29 — hardware registry + receipt sizing SHIPPED (backend 638 tests green +6 HardwareDeviceTest; panel tsc+build clean; backend 0ebbbde, panel 22de77c):**
- `hardware_devices` table (tenant_id, type, name, brand, model, connection_type, connection_value, is_default, is_active, settings JSON). type ∈ receipt_printer|label_printer|barcode_scanner|cash_drawer|customer_display; connection ∈ browser|serial|usb|bluetooth|lan|wifi|native. Model `HardwareDevice` (BelongsToTenant, TYPES/CONNECTIONS consts). HardwareDeviceController CRUD under permission:settings.manage; at-most-one-default-PER-TYPE enforced (keepSingleDefault); type immutable on update. Routes: /api/v1/hardware-devices.
- FIXED a real gap: invoice blade (resources/views/invoices/show.blade.php) had `receipt_width` setting (standard|thermal_80|thermal_58 in [[shopos-ui-conventions]] ShopSettings) but NEVER applied it — thermal receipts printed full-page. Blade now honors it: roll-width layout (48mm/72mm printable), stacked header, compact type, `@page size 58mm/80mm auto; margin 0`.
- Frontend: `src/modules/hardware/` (service/hook/HardwareDevices component). Settings → **Hardware** SectionCard: list/add/edit/remove devices + browser **Test Print** for printers (opens a printable window sized to paper_size). Invoice/receipt section now exposes the Receipt-size Select.

**Still TODO (the harder tiers):** direct ESC/POS from the browser via Web Serial (feature-detected, with the print-dialog as fallback) so a Chrome/Android till prints without the OS dialog; POS auto-selecting the default receipt-printer device's transport; QR on receipt (no QR lib in either repo yet — panel hand-rolls Code128 via `code128Svg`, no server QR); label barcode symbology beyond Code128; native/Sunmi bridge. See [[shopos-offline-plan]] (PWA packaging decides how much the native-bridge tier matters).
