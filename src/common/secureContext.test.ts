import { describe, expect, it } from "vitest";

/**
 * Nothing may reach for a secure-context API directly.
 *
 * ── The bug this is a rule about ────────────────────────────────────────
 *
 * `crypto.randomUUID` exists only in a **secure context** — HTTPS, or
 * `localhost`. Served over plain http, which is every staging droplet on an IP
 * and every shop that has not got a certificate yet, it is **undefined**, and
 * calling it throws.
 *
 * It has crashed the POS once already. `common/uuid.ts` was written that day and
 * says so in its first line: prefer `randomUUID`, fall back to
 * `getRandomValues` (which DOES work over http), and finally to `Math.random` —
 * these ids are idempotency keys, not secrets.
 *
 * And then four call sites went on calling the raw API anyway. The worst was
 * the offline sale's operation id, so on a plain-http shop a cashier ringing an
 * offline sale would throw **before the sale was queued** — goods on the
 * counter, nothing recorded.
 *
 * A helper written because of a bug does not prevent the bug. Only a rule does.
 *
 * ── Why a source scan and not a runtime guard ───────────────────────────
 *
 * jsdom runs in a secure context and defines `crypto.randomUUID`, so every unit
 * test passes against code that a shop on http cannot execute. **The test
 * environment agrees with the code instead of with the world** — which is
 * exactly how this survived. Reading the source is the only check that does not
 * inherit the environment's opinion.
 */

const SOURCES = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Where the fallback itself lives. It is allowed to name the API it guards. */
const HELPER = "common/uuid.ts";

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

/** APIs that are simply absent over plain http, with what to use instead. */
const FORBIDDEN: Array<{ pattern: RegExp; api: string; use: string }> = [
  { pattern: /\bcrypto\s*\.\s*randomUUID\s*\(/, api: "crypto.randomUUID()", use: "uuid() from common/uuid" },
];

const offenders = (): string[] => {
  const found: string[] = [];

  for (const [path, text] of Object.entries(SOURCES)) {
    const where = path.replace(/^\.\.\//, "");
    if (where === HELPER || /\.test\.tsx?$/.test(where)) continue;

    const code = stripComments(text);

    for (const { pattern, api, use } of FORBIDDEN) {
      if (pattern.test(code)) found.push(`${where} → ${api}, use ${use}`);
    }
  }

  return found;
};

describe("a secure-context API is not available to every shop", () => {
  it("reads the whole app, so a silent zero cannot pass as a clean sweep", () => {
    // The denominator. A matcher that quietly read nothing would report the
    // same empty list as a codebase that is genuinely clean.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(200);
  });

  it("bites when something calls the raw API", () => {
    // Proves the pattern matches rather than trusting an empty result.
    const { pattern } = FORBIDDEN[0];
    expect(pattern.test("const id = crypto.randomUUID();")).toBe(true);
    expect(pattern.test("const id = crypto . randomUUID ()")).toBe(true);
    expect(pattern.test("const id = uuid();")).toBe(false);
  });

  it("does not count a mention in a comment", () => {
    // The helper and this file both NAME the API they guard. A rule a leftover
    // sentence can trip is not a rule.
    expect(stripComments("// crypto.randomUUID() is unavailable\nconst a = 1;")).not.toContain("randomUUID");
  });

  it("finds nothing reaching past the fallback", () => {
    expect(offenders()).toEqual([]);
  });
});
