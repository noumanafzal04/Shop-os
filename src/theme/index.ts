/**
 * THE SEAM. The theme itself lives in `@cartze/core`.
 *
 * ── Why this file stays ──────────────────────────────────────────────
 *
 * Sixty-eight files in this app import `"../../theme"`. Repointing all of
 * them in the same commit that moves the code would be one change with
 * nothing green in between, and this app has a released APK.
 *
 * So the barrel stays and forwards. The imports below it never knew where
 * the theme lived and still do not — which is the whole point of a barrel,
 * and the reason this move cost two files instead of sixty-eight.
 *
 * `tokens.ts` and `themes.ts` used to sit beside this as seams of their own.
 * They are gone: the two tests that imported them directly now name the
 * package, and a seam nothing uses is a file that outlives its reason.
 */
export * from "@cartze/core/theme";
