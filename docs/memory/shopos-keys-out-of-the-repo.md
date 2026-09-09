---
name: shopos-keys-out-of-the-repo
description: "mobile maps keys live in gitignored src/common/secrets.ts with a tracked example + postinstall copy; the APK still leaks them"
metadata:
  type: project
---

Mobile API keys are in `src/common/secrets.ts` (**gitignored**), imported by
`config.ts`. `secrets.example.ts` is tracked and empty, and `postinstall`
copies it when the real file is missing so a fresh clone still bundles.
`MAPS_PROVIDER` is `"google"`; both provider branches exist in
`src/services/geo.ts`.

**Why:** a working Geoapify key sat in `config.ts` as a literal and is in
public git history to this day — rotating it is the only fix. The comment above
it said "set the key locally and do not commit it", a rule one `git add -A`
defeats.

**How to apply:** `__tests__/secretsStayOut.test.ts` asks GIT (ignored, never
tracked, example empty) and scans every tracked file for
`AIza[0-9A-Za-z_-]{35}`. `git` and `bodyOf`/`statementAt` now live in
`__tests__/support/node.ts` as one shared copy.

**This does not protect the key.** It is compiled into
`index.android.bundle` and greppable out of the APK. The only real defence is
provider-side: Google Cloud application restrictions (package
`com.shoposmobile` + release SHA-1) and an API allow-list of Geocoding +
Places. STILL PENDING: rotate the Geoapify key, restrict/rotate the Google key
(pasted in chat twice), rotate the GitHub password.

See [[shopos-maps-location]], [[shopos-page-nobody-could-open]].
