import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A SAVE THAT FAILS HAS TO SAY SO.
 *
 * Of 220 places in this panel that call `.mutate()`, twenty-five handled
 * failure nowhere: not on the call, not on the mutation's own declaration, not
 * by rendering `.error`, not in a `try`. They pass an `onSuccess` that shows a
 * toast and nothing for the other outcome — so a save that fails looks exactly
 * like one that worked, because the toast simply never appears.
 *
 * `TaxGroupsManager` was the sharpest: "Tax group saved" on success, and no
 * error path anywhere in the file. A shop changing its GST rate could be told
 * nothing at all and go on selling at the old one.
 *
 * ── The number was wrong five times before it was right ─────────────────
 *
 *   194  useMutation declarations with no `onError`
 *        — counts HOOKS. `useCatalog.ts` declares twenty and handles none,
 *          because the page that calls them does.
 *    81  call sites with no inline `onError`
 *        — misses the ones whose own declaration carries one.
 *    68  …and misses `{ ...failed(…) }`, and options built into a variable
 *        two lines above. The guard could not see the fix it asks for.
 *    46  …and misses an ALIAS: `const mutation = isEdit ? update : create`,
 *          which is how the product form — the most-used write in the panel,
 *          rendering field errors beside the very inputs — landed on the list.
 *    30  …and misses `mutateAsync` inside a wrapper that try/catches, which is
 *          how the forecourt got five entries for handling failure better than
 *          most of this panel.
 *    25  the honest number. Fixed, all of them.
 *
 * Same mistake as the "245 unnamed form fields" that were really 34: a count is
 * only as good as the layer it was taken at, and a detector that cannot see the
 * remedy will keep reporting the disease.
 */
const SRC = path.join(__dirname, "..", "src");

/**
 * ZERO. Not a ratchet any more — a gate.
 *
 * It started as a ratchet at 66 because that looked like too many to fix in one
 * sitting. Five of those "66" turned out to be the detector's own blind spots
 * (see above), and the twenty-five that were real took an afternoon. A rule at
 * zero is worth more than a backlog nobody pays down.
 */
const SILENT_SAVES_ALLOWED = 0;

interface Silent {
  file: string;
  line: number;
  what: string;
}

function sources(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
        out.push({ file: path.relative(SRC, full), src: fs.readFileSync(full, "utf8") });
      }
    }
  };

  walk(SRC);

  return out;
}

/** The whole `(...)` of a call that starts at `from`. */
function callAt(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }

  return src.slice(from, from + 600);
}

/**
 * Does this call hand the failure somewhere?
 *
 * Three shapes, and the guard could originally only see the first — so it could
 * not see the very fix it asks for, which is the third time in one day a
 * detector has been blind to its own subject:
 *
 *   1. `mutate(x, { onError: … })`     an inline handler
 *   2. `mutate(x, { ...failed(…) })`   the shared helper, spread in place
 *   3. `mutate(x, opts)`               a variable built a few lines above
 *
 * The third is the common one, because a page usually shares one options object
 * between its create and its update.
 */
function handles(call: string, src: string): boolean {
  if (call.includes("onError") || call.includes("failed(")) return true;

  // `mutate(payload, opts)` — chase a bare identifier to its definition.
  const passed = /,\s*([A-Za-z_$][\w$]*)\s*\)\s*$/.exec(call.trim());
  if (!passed) return false;

  const def = new RegExp(`(?:const|let)\\s+${passed[1]}\\s*=\\s*\\{`).exec(src);
  if (!def) return false;

  // BRACE-MATCHED, not a fixed window. A 900-character slice from `const done
  // = {` ran straight past the end of the object and into the next handler in
  // the file — so removing the only handler `done` had still looked handled,
  // and a mutation test found the gate could not fail at all.
  const block = callAt(src, src.indexOf("{", def.index));

  return block.includes("onError") || block.includes("failed(");
}

/** Does `name = useMutation({…})` in this source carry an onError? */
function declaredWithOnError(src: string, name: string): boolean | null {
  for (const pattern of [
    new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*useMutation\\(`),
    new RegExp(`\\b${name}\\s*:\\s*useMutation\\(`),
  ]) {
    const m = pattern.exec(src);
    if (m) {
      // Same brace-match, same reason.
      const block = callAt(src, src.indexOf("(", m.index));

      return block.includes("onError") || block.includes("failed(");
    }
  }

  return null;
}

/**
 * Is this mutation's failure rendered anywhere in the file — under ANY name?
 *
 * A page routinely aliases the pair it is using:
 *
 *     const mutation = isEdit ? update : create;
 *     const generalError = mutation.error instanceof ApiError ? … : null;
 *     {generalError && <Alert variant="error" title="Couldn't save" …/>}
 *
 * Asking only about `update.error` calls that silent, which is how the product
 * form — the most-used write in the panel, and one that renders field errors
 * beside the very inputs that caused them — landed on the list. So the aliases
 * are followed one hop: any name assigned from an expression that mentions this
 * mutation counts as the same thing.
 */
function readsError(src: string, name: string): boolean {
  if (new RegExp(`\\b${name}\\.(?:error|isError)\\b`).test(src)) return true;

  const alias = new RegExp(`(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[^;\\n]*\\b${name}\\b[^;\\n]*;`, "g");
  let m: RegExpExecArray | null;
  while ((m = alias.exec(src)) !== null) {
    if (new RegExp(`\\b${m[1]}\\.(?:error|isError)\\b`).test(src)) return true;
  }

  return false;
}

function findSilent(): { silent: Silent[]; total: number } {
  const silent: Silent[] = [];
  let total = 0;

  for (const { file, src } of sources()) {
    if (!src.includes(".mutate")) continue;

    const calls = /\b([\w.]+?)\.(?:mutate|mutateAsync)\s*\(/g;
    let m: RegExpExecArray | null;

    while ((m = calls.exec(src)) !== null) {
      total++;
      const obj = m[1];
      const leaf = obj.split(".").pop() ?? obj;
      const root = obj.split(".")[0];
      const line = src.slice(0, m.index).split("\n").length;

      const call = callAt(src, m.index + m[0].length - 1);
      if (handles(call, src)) continue;
      if (declaredWithOnError(src, leaf) === true) continue;
      if (readsError(src, root) || readsError(src, leaf)) continue;

      // `mutateAsync` REJECTS, so the only ways to use it are `await` inside a
      // try, or `.catch()`. A file that does neither anywhere is the concern —
      // and the twelve-line window missed the commonest shape by a mile:
      //
      //     const run = async (fn, ok) => { try { await fn(); toast.success(ok) }
      //                                     catch (e) { toast.error(…) } };
      //     run(() => m.deleteTank.mutateAsync(t.id), "Tank removed");
      //
      // The forecourt handles failure better than most of this panel and had
      // five entries on the list for it.
      const isAsync = m[0].includes("mutateAsync");
      if (isAsync && (src.includes("catch") || src.includes(".catch("))) continue;

      const above = src.split("\n").slice(Math.max(0, line - 12), line).join("\n");
      if (above.includes("try {") || above.includes("catch")) continue;

      silent.push({ file, line, what: obj });
    }
  }

  return { silent, total };
}

describe("a save that fails says so", () => {
  const { silent, total } = findSilent();

  it("read enough call sites to be worth believing", () => {
    // THE DENOMINATOR. A walker that found no files reports a clean panel, and
    // a clean panel is what this rule is trying to earn rather than assume.
    expect(sources().length, "the source walk found almost nothing").toBeGreaterThan(300);
    expect(total, "no .mutate() call sites were read at all").toBeGreaterThan(150);
    // Printed so the ratchet can be lowered without guessing at it.
    console.log(`  saves that fail in silence: ${silent.length} of ${total}`);
  });

  it("has no saves that can fail in silence", () => {
    const worst = [...silent]
      .reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.file]: (acc[s.file] ?? 0) + 1 }), {});
    const named = Object.entries(worst)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([f, n]) => `  ${n}  ${f}`)
      .join("\n");

    expect(
      silent.length,
      `${silent.length} of ${total} saves can fail with nothing on screen — the allowance is `
      + `${SILENT_SAVES_ALLOWED}. Worst files:\n${named}\n\n`
      + "Pass `failed(toast, \"…\")` from src/common/api/failed.ts as the mutate options, "
      + "or handle it however this screen already speaks — the till uses a standing notice, not a toast.",
    ).toBeLessThanOrEqual(SILENT_SAVES_ALLOWED);
  });
});
