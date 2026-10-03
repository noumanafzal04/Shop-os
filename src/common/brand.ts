/**
 * This app's name — the product's, with nothing added.
 *
 * ── The name itself lives in `@cartze/core/brand` ────────────────────
 *
 * It used to be written out on the line below, and the shop app wrote it out
 * on a line of its own, and the panel wrote it out in seventy-three page
 * titles. Three "one places" is not one place, and they had already drifted
 * apart — two apps said CartZe while the panel said True Serve.
 *
 * So this file keeps only what is TRUE OF THIS APP: the version a person
 * reads on a support call, and the addresses below that do not follow a
 * rename. `PRODUCT` owns the rest. See its docblock for the branding-versus-
 * address rule, which is why `domain`, `scheme`, `shopos.auth` and
 * `com.shoposmobile` all keep their old spelling.
 */
import { PRODUCT, productName } from "@cartze/core/brand";

export const BRAND = {
  /** The product's own name, unqualified — this IS the customer app. */
  name: productName(),

  /** An ADDRESS, not branding. Shown in support copy, never fetched. */
  domain: PRODUCT.domain,

  /**
   * WHAT IS INSTALLED, as a person reads it.
   *
   * Stated here and not read from anywhere, because there is nowhere to read
   * it FROM: `versionName` lives in Gradle and `CFBundleShortVersionString` in
   * a plist, neither of which JavaScript can see without a native module this
   * app deliberately does not have.
   *
   * A constant that has to agree with a file it cannot read is a constant that
   * will one day disagree quietly — so `appVersion.test.ts` reads the Gradle
   * file and fails when the two drift. That is the whole reason this line is
   * safe to trust on a support call, which is the only reason it is shown.
   */
  version: "1.2.0",

  /**
   * The deep-link scheme, e.g. `cartze://orders/123`. An ADDRESS — see
   * `PRODUCT`. Registered in native config, so changing it in JavaScript
   * alone would leave a scheme the OS never routes, and links already sent to
   * phones would stop resolving.
   */
  scheme: PRODUCT.scheme,
} as const;

/**
 * ── Renaming checklist ────────────────────────────────────────────────
 *
 * Edit `PRODUCT.name` in `@cartze/core/brand`. That is everything drawn in
 * JavaScript, in all three clients.
 *
 * Native platforms cannot read a TypeScript constant, so two label resources
 * follow by hand — and they are not left to memory. `appName.test.ts` reads
 * both and fails naming the exact value to paste:
 *
 *   1. `android/app/src/main/res/values/strings.xml`  → `app_name`
 *   2. iOS `Info.plist` → `CFBundleDisplayName`
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
 *   `shopos.auth`                        the Keychain service (see `PRODUCT`)
 */
