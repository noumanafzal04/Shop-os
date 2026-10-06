---
name: shopos-settings-what-listens
description: Journey stage G (30 cases) — every Settings tab changed on screen, reloaded, checked where used; 5 faults fixed; what hardware really connects
metadata:
  type: project
---

`panel/e2e/journey/12-the-settings.spec.ts`. A setting can fail three ways: not saved, not surviving a reload, read by nothing. Each case changes it ON the Settings screen and looks where it is used, then restores (`settingsBefore` in the journey record).

**Fixed 2026-10-06:**
- `tips_enabled` was read only by the dine-in tab → counter till has a Tip box (`tillBill` `tip`; added BEFORE cash rounding; fixtures v2).
- Settings Save PUT all 59 keys from a stale snapshot → sends only touched keys (`touched` ref in ShopSettingsPage); shows fresh server values for the rest.
- Wrong till PIN counted twice: API client retried every 401. `sessionHasExpired()` retries only `UNAUTHENTICATED`/no code. **Same code still in `core/src/api/client.ts` (mobile) — unchanged.**
- Kitchen stations textarea re-parsed per keystroke (Enter and spaces eaten) → `StationsField`.
- Raw `<textarea>` has no accessible name → `NamedTextarea`; `noRawTextarea.test.ts` guards.

**Hardware truth (user asked "kab connect hote hain"):** print = browser print window, any OS printer, always. Drawer = Web Serial pulse, Chrome/Edge on a computer only, device Serial/USB, "Connect drawer" once. Scanner = keyboard. Scale = label barcode (online + offline). Bluetooth/LAN/Wi-Fi/native options and the address box do nothing. `hardware/connection.ts` says so on the form, tied to `canKick()`.

**How to apply:** idle lock must be tested on a REAL clock (fake clock never locks). A PIN hand-over kills the previous session by design — `kit.session()` checks alive, not just young. New setting → add a stage-G case.

Related: [[shopos-switch-with-nothing-behind-it]], [[shopos-promise-in-another-file]], [[shopos-the-journey]]
