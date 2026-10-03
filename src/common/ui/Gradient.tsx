/**
 * Lives in `@cartze/core`. This line is the seam — see `src/theme/index.ts`
 * for why the app reaches the shared layer through a file of its own rather
 * than naming the package at sixty-eight call sites.
 *
 * Written as a seam even though this component was never MOVED: every other
 * file in this folder is one, and `brand.test.ts` allows exactly this line
 * and not a bare import of the package. That is the guard being narrow on
 * purpose — see its `SEAM` note — and the cheaper answer is to keep the
 * convention rather than to widen a rule about where the product's name may
 * appear.
 */
export * from "@cartze/core/ui/Gradient";
