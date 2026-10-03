/**
 * THE PRODUCT'S NAME, FOR EVERY CLIENT THAT HAS ONE.
 *
 * ── Why this moved up here ───────────────────────────────────────────
 *
 * Each app already kept the name in one file of its own, which was the right
 * idea applied one level too low. Three apps meant three "one places", and
 * they had already drifted: the customer app and the shop app said "CartZe"
 * while the panel said "True Serve" — in seventy-three page titles, each one
 * spelling it out by hand.
 *
 * Asked for directly: *"make unique place agr dobara phr name change krna pr
 * geya to easily kr skain"*. So the name is stated ONCE, here, and the three
 * clients derive theirs from it. A rename is this line.
 *
 * ── What is branding, and what is an ADDRESS ─────────────────────────
 *
 * This distinction is the whole reason a rename is safe, and it predates this
 * file — both app-level `brand.ts` files argued it and they were right.
 *
 * BRANDING is what a person READS: a wordmark, a page title, the line under a
 * permission prompt. It may change as often as the company likes.
 *
 * An ADDRESS is a key something is stored under or routed by, even when it
 * contains the old name. Renaming one does not move what it points at — it
 * points somewhere empty, and the data is simply gone:
 *
 *   `shopos.auth`, `shopos.prefs`   the customer app's Keychain services
 *   `shopos-till`, `shopos-*`       the panel's IndexedDB / localStorage keys,
 *                                   one of which holds the offline outbox
 *   `cartze.partner.auth`           the shop app's Keychain service
 *   `com.shoposmobile`              Android applicationId — the Play listing
 *   `com.cartze.partner`            the same, for the shop app
 *   `cartze.shop`                   the domain, and the API's host
 *   `cartze://`                     the deep-link scheme, registered natively
 *
 * None of those follow a rename. If one ever has to change it is a MIGRATION
 * that reads the old key and writes the new, never a find-and-replace.
 */
export const PRODUCT = {
  /**
   * What a person reads. CHANGE THIS LINE TO RENAME THE PRODUCT.
   *
   * Two native label files cannot read it — Android's `strings.xml` and iOS's
   * `Info.plist` are read by the OS before any JavaScript exists. They are not
   * left to memory: `appName.test.ts` in each app reads both files and fails
   * naming the exact value to paste, so the checklist is enforced rather than
   * remembered.
   */
  name: "True Serve",

  /**
   * The marketing site, and the API's host. An ADDRESS — see above. It keeps
   * its spelling through a rename, and is shown in support copy rather than
   * fetched.
   */
  domain: "cartze.shop",

  /**
   * The deep-link scheme, e.g. `cartze://orders/123`. An ADDRESS, registered
   * in `AndroidManifest.xml` and `CFBundleURLSchemes`; changing it here alone
   * would leave a scheme the OS never routes, and every link already sent to
   * a phone would stop resolving.
   */
  scheme: "cartze",
} as const;

/**
 * A client's own name — the product, plus what this one is FOR.
 *
 * The shop app is "True Serve Partner" and the customer app is just "True
 * Serve". Written as a function so the suffix is the only thing a client
 * states, and so a rename cannot leave one app renamed and the other not.
 */
export function productName(suffix?: string): string {
  return suffix ? `${PRODUCT.name} ${suffix}` : PRODUCT.name;
}

/**
 * The name, safe to put in a FILENAME — "true-serve".
 *
 * A downloaded file is branding: it sits in somebody's Downloads folder with
 * the product's name on it. But it cannot be the name verbatim — a space in a
 * `Content-Disposition` filename is a quoting problem, and a capital is a
 * different file on a case-sensitive disk.
 *
 * It is NOT a key. Nothing is stored under this, so it is free to change with
 * the name — which is exactly the opposite of everything listed under
 * ADDRESSES above, and the reason it is a separate function rather than
 * another field on `PRODUCT`.
 */
export function productSlug(): string {
  return PRODUCT.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
