/**
 * This app's name — the product's, plus what this client is FOR.
 *
 * ── The name itself lives in `@cartze/core/brand` ────────────────────
 *
 * It used to be written out on the line below, and the customer app wrote it
 * out on a line of its own, and the panel wrote it out in seventy-three page
 * titles. Three "one places" is not one place, and they had drifted — two
 * apps said CartZe while the panel said True Serve.
 *
 * So this file states only the SUFFIX. `PRODUCT` owns the rest, and a rename
 * cannot leave one app renamed and another not.
 *
 * ── What belongs here, and what emphatically does not ──────────────────
 *
 * BRANDING is what a person reads: the wordmark, a screen title, the line
 * under a permission prompt. All of that follows a rename.
 *
 * An ADDRESS does not, even when it contains the name. Renaming one does not
 * move the data it points at — it points somewhere empty and the data is
 * simply gone:
 *
 *   `cartze.partner.auth`   the Keychain service holding this app's session
 *   `cartze.partner.prefs`  its settings
 *   `com.cartze.partner`    the Android applicationId — the Play Store listing
 *                           itself, and unchangeable after the first publish
 *
 * Those keep their spelling whatever the product ends up being called. The
 * customer app's equivalents are spelled `shopos.*` for exactly this reason:
 * they were named before an earlier rename and could not follow it.
 */
import { PRODUCT, productName } from "@cartze/core/brand";

export const BRAND = {
  /**
   * What a person reads.
   *
   * "Partner" is the only part this app decides. A shopkeeper installing both
   * has to tell them apart in a launcher, and the suffix is what does it.
   */
  name: productName("Partner"),

  /** The half that is the product; used where "Partner" would be noise. */
  family: PRODUCT.name,

  /** An ADDRESS, not branding. Shown in support copy, never fetched. */
  domain: PRODUCT.domain,

  /**
   * WHAT IS INSTALLED, as a person reads it.
   *
   * Stated here and not read from anywhere, because there is nowhere to read
   * it FROM: `versionName` lives in Gradle and `CFBundleShortVersionString` in
   * a plist, neither of which JavaScript can see without a native module this
   * app deliberately does not have. The customer app pays for that with a test
   * comparing the two; this one will need the same guard the day it ships.
   */
  version: "0.1.0",
} as const;

/**
 * ── Renaming checklist ────────────────────────────────────────────────
 *
 * Edit `PRODUCT.name` in `@cartze/core/brand`. That is everything drawn in
 * JavaScript, in all three clients.
 *
 * Two native label resources cannot read it and follow by hand —
 * `appName.test.ts` reads both and fails naming the exact value to paste:
 *
 *   1. `android/app/src/main/res/values/strings.xml`  → `app_name`
 *   2. iOS `Info.plist` → `CFBundleDisplayName`
 */
