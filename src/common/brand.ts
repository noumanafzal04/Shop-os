/**
 * The product's name, in ONE place.
 *
 * The name is expected to change again, so nothing anywhere else may spell it
 * out. A screen that needs the name imports `BRAND.name`; a test that checks
 * the name asserts against `BRAND.name` too, so a rename is one edit and the
 * suite follows it rather than failing.
 *
 * ── What belongs here, and what emphatically does not ──────────────────
 *
 * BRANDING is what a person reads: the wordmark, a page title, the line under
 * a permission prompt. All of that lives here.
 *
 * An ADDRESS is not branding, even when it happens to contain the old name.
 * These keep their spelling for ever, because renaming one does not move the
 * data it points at — it points somewhere empty and the data is simply gone:
 *
 *   `shopos.auth`      the Keychain service holding the session. Rename it and
 *                      every signed-in user is signed out, silently.
 *   `shopos-*`         the web panel's IndexedDB / localStorage keys. The
 *                      offline outbox lives in one of them — see the panel's
 *                      `storageKeys.test.ts`, which is mutation-proven.
 *
 * If one of those ever has to change it is a MIGRATION that reads the old name
 * and writes the new, never a find-and-replace.
 */
export const BRAND = {
  /** What a person reads. Change this line to rename the product. */
  name: "CartZe",

  /** Where the marketing site lives. Shown in support copy, never fetched. */
  domain: "cartze.shop",

  /**
   * The deep-link scheme, e.g. `cartze://orders/123`.
   *
   * NOT derived from `name`: it is registered in native config, so changing it
   * here alone would leave a scheme the OS never routes. To change it you must
   * also edit `android/app/src/main/AndroidManifest.xml` and the iOS
   * `CFBundleURLSchemes`, and links already sent to phones stop resolving.
   *
   * Neither platform registers one yet, so today this only strips a prefix a
   * notification might carry.
   */
  scheme: "cartze",
} as const;

/**
 * ── Renaming checklist ────────────────────────────────────────────────
 *
 * Native platforms cannot read a TypeScript constant, so a rename is this file
 * plus two label resources. Listed here so it is a checklist and not a hunt:
 *
 *   1. `BRAND.name` above                        — everything drawn in JS
 *   2. `android/app/src/main/res/values/strings.xml`  → `app_name`
 *      (the label under the launcher icon)
 *   3. iOS `Info.plist` → `CFBundleDisplayName`  (same, on iOS)
 *
 * These four are IDENTIFIERS and stay as they are, whatever the product is
 * called. They are how the OS and the app stores know this app apart from
 * every other one; changing one after a release either orphans the install or
 * is rejected outright:
 *
 *   `app.json` → `name`                  must equal MainActivity's
 *                                        `getMainComponentName()`
 *   `com.shoposmobile`                   Android applicationId — the Play
 *                                        Store listing itself
 *   `ShoposMobile.xcodeproj`             the iOS target
 *   `shopos.auth`                        the Keychain service (see above)
 */
