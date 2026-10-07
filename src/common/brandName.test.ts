import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRODUCT } from "./brand";

/**
 * THE PRODUCT'S NAME IS WRITTEN ONCE.
 *
 * ── What this is the fix for ─────────────────────────────────────────
 *
 * Seventy-three page titles spelled it out by hand, and so did the wordmark,
 * the 404 footer, the PWA manifest and `index.html`. The phones spelled a
 * DIFFERENT name out in a constant of their own, so the product shipped under
 * two names at once and nobody could tell which was stale.
 *
 * Asked for directly: *"make unique place agr dobara phr name change krna pr
 * geya to easily kr skain"*. The name now lives in `@cartze/core/brand` and
 * every client derives it. This guard is what stops it being written out
 * again — including by a future rename that does a find-and-replace and
 * leaves literals behind.
 *
 * ── The two files that cannot import a constant ──────────────────────
 *
 * `index.html` is served before any JavaScript runs. It is checked here
 * rather than trusted, for the same reason the phones' `strings.xml` is: a
 * file that must agree with a constant it cannot read will one day disagree
 * quietly.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Source with the prose taken out — a guard that greps for the thing it
 *  forbids otherwise finds its own explanation of the thing it forbids. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the name lives in one place", () => {
  const files = sourceFiles(path.join(ROOT, "src"));

  it("scanned the tree it claims to scan", () => {
    // Without this a glob that matched nothing would report a clean sweep —
    // the same shape as asserting a response is "not empty".
    expect(files.length).toBeGreaterThan(200);
  });

  /**
   * ADDRESSES, which must keep their spelling through any rename.
   *
   * Matched as substrings of a LINE, not as whole files: a file is allowed to
   * contain `shopos-till` and still not allowed to put the product's name in
   * a sentence. That distinction is the whole point — `storageKeys.test.ts`
   * is mutation-proven and exists because renaming one of these signs every
   * user out or orphans the till's unsent sales.
   */
  const ADDRESSES = [
    // The panel's own storage. `shopos-*` predates two renames and cannot
    // follow a third — see `PRODUCT` for the migration-not-replace rule.
    "shopos-auth",
    "shopos-branch",
    "shopos-cart",
    "shopos-terminal",
    "shopos-till",
    "shopos-device-id",
    "shopos-pos-cart",
    "shopos-pos-held",
    "shopos-kitchen-station",
    "shopos-market-pin",
    "shopos-last-server-contact",
    "shopos-install-dismissed",
    "shopos-outbox-flush",
    "shopos-product-images",
    // The shop's colours as this device last saw them — rememberedTheme.ts.
    "shopos-theme",
    // When this shop's day turns, so the first "Today" of a session is right — shopDay.ts.
    "shopos-day",
    // A CSS class the map library is told to use.
    "shopos-map-pin",
    // Dismissal flags and a walkthrough marker — browser keys, same rule.
    "cartze-old-browser-dismissed",
    "cartze-qa-walked",
    "cartze-saved",
    // Firebase's name for the app instance, and the postMessage kind the
    // service worker and the page agree on. Both are protocol, not prose.
    "cartze-push",
    "cartze:notification-click",
    "cartze-test",
    // The support address. An email box does not move because a product was
    // renamed; changing it here would print an address nobody reads.
    "cartze.shop",
    // A test's own description of the rule.
    "storage keys survive the rename",
    // Fixture data.
    "@shopos.test",
  ];

  it("is not written out in any screen", () => {
    /**
     * Past names count. A rename that only moves `PRODUCT.name` DISARMS a
     * guard that checks the current name alone: the old one stops being
     * forbidden on the very day every stale copy of it starts mattering.
     */
    const names = [PRODUCT.name, "CartZe", "ShopOS"];

    const offences: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      // The constant itself, and this guard, are where the names belong.
      if (rel.endsWith("src/common/brand.ts") || rel.endsWith("brandName.test.ts")) continue;

      codeOnly(fs.readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          /*
            A MODULE SPECIFIER IS NOT A BRAND MENTION.

            The shared package is called `@cartze/core`, so every file that
            imports the theme or the palette from it carries the old product
            name on an import line. The customer app's guard already decided
            this one, and the reasoning is the same here: what this rule
            protects is the name appearing in anything a PERSON reads — a
            title, a toast, a store listing. A specifier is resolved by three
            config files and never rendered.

            Narrow on purpose: a line that is EXACTLY an import or re-export
            of that package. A toast saying "Welcome to CartZe" is still
            caught, and so is an import used to build a string.
          */
          if (/^\s*(?:import|export)\b[^"']*from\s*["']@cartze\/core[^"']*["'];?\s*$/.test(line)) return;
          if (ADDRESSES.some((a) => line.includes(a))) return;
          if (names.some((n) => line.toLowerCase().includes(n.toLowerCase()))) {
            offences.push(`  ${rel}:${i + 1}  ${line.trim()}`);
          }
        });
    }

    expect(offences.join("\n")).toBe("");
  });
});

describe("the files that cannot import it still agree with it", () => {
  it("gives index.html the same title", () => {
    const html = read("index.html");
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];

    expect({ file: "index.html", title }).toEqual({ file: "index.html", title: PRODUCT.name });
  });

  it("gives the iOS home-screen label the same name", () => {
    // What sits under the icon when the till is installed to an iPad's home
    // screen. It is a SEPARATE fact from <title> — see the note in the file —
    // which is exactly why it can drift on its own.
    const label = /name="apple-mobile-web-app-title" content="([^"]*)"/.exec(read("index.html"))?.[1];

    expect({ meta: "apple-mobile-web-app-title", label }).toEqual({
      meta: "apple-mobile-web-app-title",
      label: PRODUCT.name,
    });
  });

  it("builds the PWA manifest from the constant rather than a literal", () => {
    // `vite.config.ts` is TypeScript run by Node, so unlike `index.html` it
    // CAN import the constant — and it does. Asserted as source because the
    // manifest itself only exists after a build.
    const config = read("vite.config.ts");
    expect(config).toMatch(/name:\s*PRODUCT\.name/);
    expect(config).toMatch(/short_name:\s*PRODUCT\.name/);
  });
});

describe("addresses do NOT follow a rename", () => {
  /**
   * The other half of the rule, and the half that costs real data. A key
   * something is STORED under is not branding, even when it contains the old
   * name: renaming it does not move what it points at, it points somewhere
   * empty, and the till's unsent sales are in one of them.
   */
  it("keeps the storage keys and the domain exactly as they are", () => {
    expect(PRODUCT.domain).toBe("cartze.shop");

    // `shopos-*` is the panel's storage prefix. `storageKeys.test.ts` holds
    // the full list and is mutation-proven; this is the reminder that a
    // rename must not go near it.
    const sw = read("vite.config.ts");
    expect(sw).toContain("shopos-product-images");
  });
});
