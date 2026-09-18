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
Places. STILL PENDING: rotate the Geoapify key, restrict/rotate the Google Maps key
(pasted in chat twice), rotate the GitHub password. The FCM service account is
DONE — see below.

**2026-09-17 — the FCM service account was pasted into chat.** Firebase
project `cartze-38808`, account `firebase-adminsdk-fbsvc@…`, private key id
`013bb6b4…44d08`. Unlike the `api_key` inside `google-services.json` — which
ships in every APK and Google documents as non-secret — a service account key
is a real credential: it mints OAuth tokens that can send push as this project
and reach Firebase Auth admin. It was deliberately NOT written to disk at the time; installing a burned
credential only makes it get used.

**ROTATED the same day.** `backend/storage/app/private/fcm.json` now holds key
`161ebc51…`, generated from the GCP IAM console (which names the download
`<project-id>-<hash>.json` — no "firebase-adminsdk" in it, unlike the Firebase
console's, and that difference broke the first `mv` glob). `013bb6b4…` was then DELETED in GCP, so the leaked credential is dead. (A new
key does not retire the old one — both work until one is deleted, which is the
step people skip.)

**Proven, not assumed:** with the old key gone, `FcmSender::accessToken()` was
called through reflection and Google returned a real 1024-char OAuth token.
That exercises file → config → JWT signing → token exchange. "The JSON parses"
would have passed on the dead key too.

The rule that failed is worth stating plainly: "do not paste keys in chat" was
said, and the next message was a paste. A rule that depends on remembering is
one that gets forgotten — so the handover is now a FILE MOVE, never a value:
download, then `mv ~/Downloads/<file>.json backend/storage/app/private/fcm.json`
and say "done".

See [[shopos-maps-location]], [[shopos-page-nobody-could-open]].
