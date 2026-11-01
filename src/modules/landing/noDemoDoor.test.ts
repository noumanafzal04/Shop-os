import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * LAUNCH (the user, 2026-11-01): "landing page sy jo hum demo shop create
 * krty hain wo remove krdo — koi bnda b wahan sy demo shop na create kr sky,
 * bs query bhej sky." And: the marketplace button off the top nav.
 *
 * Every call to action on the public site goes to the walkthrough form; the
 * server has no `POST /demo` any more (DemoShopTest holds that side).
 */
const LANDING = resolve(__dirname);
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const at = join(dir, name);
    if (statSync(at).isDirectory()) return files(at);

    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [at] : [];
  });
const code = (file: string) => readFileSync(file, "utf8").replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

describe("the public site opens no shop", () => {
  it("no page links to /demo or offers to try one", () => {
    const offences = files(LANDING)
      .filter((f) => !/DemoBanner|KeepShopModal/.test(f)) // inside an existing demo shop, not on the site
      .filter((f) => /to="\/demo"|href="\/demo"|"\/demo"|Try the demo|Try it first/.test(code(f)));

    expect(offences).toEqual([]);
  });

  it("asks for a walkthrough instead, on the form at #talk", () => {
    const ask = readFileSync(join(LANDING, "components/AskForWalkthrough.tsx"), "utf8");
    const page = readFileSync(join(LANDING, "pages/LandingPage.tsx"), "utf8");

    expect(ask).toMatch(/href="\/#talk"/);
    expect(page).toMatch(/<section id="talk"/);
    expect(page).toMatch(/<EnquiryForm \/>/);
  });

  it("an old /demo address lands on the form", () => {
    const app = readFileSync(resolve(LANDING, "../../App.tsx"), "utf8");

    expect(app).toMatch(/<Route path="\/demo" element=\{<Navigate to="\/#talk" replace \/>\} \/>/);
    expect(app).not.toMatch(/DemoPage/);
  });

  it("the marketplace is off the top nav", () => {
    const header = readFileSync(join(LANDING, "components/SiteHeader.tsx"), "utf8");

    expect(header).toMatch(/const STOREFRONT_IN_NAV: boolean = false;/);
    expect(header.match(/\{STOREFRONT_IN_NAV && \(\s*<Link\s+to=\{STOREFRONT\.to\}/g)).toHaveLength(2);
  });
});
