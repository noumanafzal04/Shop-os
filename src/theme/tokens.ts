/**
 * MOVED. The tokens live in `@cartze/core` now.
 *
 * ── Why a re-export and not a rewrite of every import ────────────────
 *
 * Sixty-eight files in this app import from `../theme`, and thirty-seven
 * test files read shared code by path. Rewriting all of them in the commit
 * that moves the files would be one change with nothing green in between.
 *
 * This line keeps every existing import working while the code itself lives
 * where the second app can reach it. The re-exports come out a slice at a
 * time, as each caller is repointed — and until the last one goes, this file
 * is the seam.
 */
export * from "@cartze/core/theme/tokens";
