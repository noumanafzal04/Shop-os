/**
 * API KEYS, KEPT OUT OF THE REPOSITORY.
 *
 * ── Why this file exists ─────────────────────────────────────────────
 *
 * The keys used to be literals in `config.ts`, which is TRACKED — and this
 * repository is PUBLIC. A Geoapify key sat there and was therefore readable by
 * anyone from the moment it was committed, and rotating it became a code
 * change. The same thing was one `git add -A` away from happening again.
 *
 * So: copy this file to `secrets.ts`, put the real values there, and never
 * think about it again. `secrets.ts` is gitignored.
 *
 *     cp src/common/secrets.example.ts src/common/secrets.ts
 *
 * `npm install` does that for you if the file is missing — see the
 * `postinstall` script — so a fresh clone builds without anybody having to
 * read this comment first.
 *
 * ── What this does NOT protect against ───────────────────────────────
 *
 * The key is still bundled into the APK. It has to be: the phone makes the
 * request. Anyone with the file can pull it out, and no amount of hiding in
 * source changes that.
 *
 * The ONLY real defence for a client key is a restriction at the provider:
 *
 *   Google Cloud → Credentials → the key → Application restrictions
 *     → Android apps → package `com.shoposmobile` + the release SHA-1
 *   … and API restrictions → only Geocoding API and Places API
 *
 * A restricted key in an APK is fine. An unrestricted one is a billing
 * incident waiting for somebody to notice it.
 */

/** Geoapify — address autocomplete + reverse geocoding. */
export const GEOAPIFY_KEY = "";

/** Google Maps Platform — Geocoding API + Places API. */
export const GOOGLE_MAPS_KEY = "";
