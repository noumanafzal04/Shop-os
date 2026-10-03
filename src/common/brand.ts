/**
 * The panel's name for the product — from the one place it is written.
 *
 * ── What this replaced ───────────────────────────────────────────────
 *
 * Seventy-three page titles, each spelling "True Serve" out by hand, while
 * the two phone apps spelled "CartZe" out in a constant of their own. Three
 * "one places" is not one place, and they had already drifted into two
 * different product names shipping at the same time.
 *
 * Asked for directly: *"make unique place agr dobara phr name change krna pr
 * geya to easily kr skain"*. So the name lives in `@cartze/core/brand`, a
 * sibling folder consumed by alias — the same arrangement Metro already uses
 * for the phones. A rename is `PRODUCT.name` and nothing else in JavaScript.
 *
 * ── Where the name is now used, rather than written ──────────────────
 *
 * `PageMeta` appends it. A screen states its own title — "Customers" — and
 * the suffix is added once, so a page cannot be the one that forgets it or
 * the one that spells it differently. `brandName.test.ts` fails on any file
 * under `src` that writes the name out.
 *
 * ── The deep import is deliberate ────────────────────────────────────
 *
 * `@cartze/core/brand`, never `@cartze/core`. The barrel re-exports the
 * theme, and the theme imports `react-native`.
 */
export { PRODUCT, productName, productSlug } from "@cartze/core/brand";
