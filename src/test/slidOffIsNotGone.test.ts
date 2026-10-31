import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * #AZ16 — A PANEL SLID OFF THE EDGE IS NOT GONE.
 *
 * A drawer that is always mounted and only moved out of sight with
 * `translate-x-full` / `translate-y-full` stays in the accessibility tree. As
 * an `aria-modal="true"` dialog it tells a screen reader the page behind is
 * inert, and its controls stay in the tab order: on Expenses, Income and the
 * Ledger 20 of 70 Tabs landed in a Filters drawer nobody had opened.
 *
 * Every such panel says so when it is closed: `aria-hidden` and `inert`.
 */
const SRC = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }

  return out;
}

const slidPanels = walk(SRC).filter((f) => {
  const code = fs.readFileSync(f, "utf8");

  return /aria-modal="true"/.test(code) && /translate-[xy]-full/.test(code);
});

describe("a modal panel slid out of sight is hidden from readers and the keyboard", () => {
  it("found the slid panels — so a clean result means something", () => {
    const names = slidPanels.map((f) => path.basename(f));

    expect(names).toContain("MoneyFilterBar.tsx");
    expect(names).toContain("ThemeCustomizer.tsx");
  });

  it.each(slidPanels.map((f) => [path.relative(SRC, f), f]))("%s", (_name, file) => {
    const code = fs.readFileSync(file, "utf8");

    expect(code).toMatch(/aria-hidden=\{!open\}/);
    expect(code).toMatch(/inert=\{!open\}/);
  });
});
