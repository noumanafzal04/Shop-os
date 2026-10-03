/**
 * The panel's name for the product.
 *
 * ── Why this is a COPY, and what keeps it honest ─────────────────────
 *
 * The name's origin is `core/src/brand.ts`, which the two phone apps import
 * by alias. The panel tried that too and it broke the DEPLOY: `core` is a
 * sibling repo on a developer's machine and does not exist on the server,
 * where only this repository is checked out at `/var/www/shopos-panel`. The
 * build failed with "Cannot find module '@cartze/core/brand'" — correct, and
 * a reminder that "one place" has to mean one place *that ships*.
 *
 * So the panel carries its own copy and `brandName.test.ts` compares the two
 * when `../core` is present, which it is on every machine a change is written
 * on. A copy with a guard over it is not the drift this replaced: that was
 * three copies and nothing comparing any of them.
 *
 * ── What is branding, and what is an ADDRESS ─────────────────────────
 *
 * BRANDING is what a person READS — a page title, a wordmark, a toast. It may
 * change whenever the company likes.
 *
 * An ADDRESS is a key something is stored under, even when it contains the
 * old name. Renaming one does not move what it points at; it points somewhere
 * empty, and the till's unsent sales are behind one of them:
 *
 *   `shopos-till`      the offline database — the outbox lives in it
 *   `shopos-auth`      the session
 *   `cartze.shop`      the domain, and the API's host
 *
 * Those keep their spelling. If one ever has to change it is a MIGRATION that
 * reads the old key and writes the new, never a find-and-replace.
 */
export const PRODUCT = {
  /** What a person reads. CHANGE THIS LINE, and the same line in `core`. */
  name: "True Serve",

  /** An ADDRESS — see above. Shown in support copy, never fetched. */
  domain: "cartze.shop",
} as const;

/** A client's own name — the product, plus what this one is FOR. */
export function productName(suffix?: string): string {
  return suffix ? `${PRODUCT.name} ${suffix}` : PRODUCT.name;
}

/**
 * The name, safe to put in a FILENAME — "true-serve".
 *
 * A downloaded file is branding: it lands in somebody's Downloads folder with
 * the product's name on it. But it cannot be the name verbatim — a space
 * needs quoting in a `Content-Disposition` header and a capital is a
 * different file on a case-sensitive disk.
 *
 * It is NOT a key. Nothing is stored under it, so unlike the addresses above
 * it is free to follow a rename.
 */
export function productSlug(): string {
  return PRODUCT.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
