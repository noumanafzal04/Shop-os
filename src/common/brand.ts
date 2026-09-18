/**
 * The product's name, in ONE place.
 *
 * ── What belongs here, and what emphatically does not ──────────────────
 *
 * BRANDING is what a person reads: the wordmark, a screen title, the line
 * under a permission prompt. All of that lives here and may change freely.
 *
 * An ADDRESS is not branding, even when it contains the name. Renaming one
 * does not move the data it points at — it points somewhere empty and the data
 * is simply gone:
 *
 *   `cartze.partner.auth`   the Keychain service holding this app's session
 *   `cartze.partner.prefs`  its settings
 *   `com.cartze.partner`    the Android applicationId — the Play Store listing
 *                           itself, and unchangeable after the first publish
 *
 * Those keep their spelling whatever the product ends up being called. The
 * customer app's equivalents are spelled `shopos.*` for exactly this reason:
 * they were named before the rename and could not follow it.
 */
export const BRAND = {
  /** What a person reads. Change this line to rename the product. */
  name: "CartZe Partner",

  /** The half that is the product; used where "Partner" would be noise. */
  family: "CartZe",

  /** Where the marketing site lives. Shown in support copy, never fetched. */
  domain: "cartze.shop",

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
