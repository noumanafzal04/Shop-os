import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import fs from "node:fs";
import path from "node:path";

import Select from "./Select";

/**
 * THE RETAIL FLOW, #4 (2026-10-21): "Round cash bills to" listed "Nothing —
 * exact to the paisa" twice — the placeholder, disabled, then the real choice.
 */
const ROUNDING = [
  { value: "0", label: "Nothing — exact to the paisa" },
  { value: "1", label: "Nearest Rs 1" },
];

describe("a select that always holds one of its choices", () => {
  it("lists each choice once, with no dead line above them", () => {
    render(<Select aria-label="Round cash bills to" value="0" options={ROUNDING} placeholder={null} onChange={() => {}} />);

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Nothing — exact to the paisa", "Nearest Rs 1"]);
  });

  it("still opens with its placeholder where one is asked for", () => {
    render(<Select aria-label="Kind" options={ROUNDING} onChange={() => {}} />);

    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Select an option");
  });
});

/**
 * #AZ18 — the same shape came back on the item form three times: Category,
 * Tax group and Kitchen station each listed their empty choice twice, the
 * placeholder's copy dead. No Select may name its empty choice AND a
 * placeholder of the same words.
 */
describe("no picker lists its empty choice twice", () => {
  const SRC = path.resolve(__dirname, "../..");
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const at = path.join(dir, e.name);
      if (e.isDirectory()) return files(at);

      return /\.tsx$/.test(e.name) && !/\.test\./.test(e.name) ? [at] : [];
    });

  it("finds the doubled shape when it is written", () => {
    expect(doubled('<Select options={[{ value: "", label: "No category" }, ...rest]} placeholder="No category" />')).toEqual(["No category"]);
    expect(doubled('<Select options={[{ value: "", label: "No category" }]} placeholder={null} />')).toEqual([]);
  });

  it("is written nowhere", () => {
    const offences = files(SRC).flatMap((f) => doubled(fs.readFileSync(f, "utf8")).map((label) => `${path.relative(SRC, f)}: "${label}"`));

    expect(offences).toEqual([]);
  });

  /**
   * #GS3 — the same dead line without a placeholder written at all: a picker
   * whose empty choice is one of its options ("Whole account", "No table")
   * still drew the default "Select an option" above it. Seven of them.
   */
  it("a picker that lists its own empty choice says placeholder={null}", () => {
    expect(silentlyDoubled('<Select value={x} options={[{ value: "", label: "Whole account" }, ...rest]} onChange={f} />')).toBe(true);
    expect(silentlyDoubled('<Select placeholder={null} options={[{ value: "", label: "Whole account" }]} onChange={f} />')).toBe(false);

    const offences = files(SRC).flatMap((f) => {
      const code = fs.readFileSync(f, "utf8");
      return [...code.matchAll(/<Select\b/g)]
        .filter((m) => silentlyDoubled(elementAt(code, m.index ?? 0)))
        .map((m) => `${path.relative(SRC, f)}:${code.slice(0, m.index).split("\n").length}`);
    });

    expect(offences).toEqual([]);
  });
});

/** One `<Select … />` element, braces and all. */
function elementAt(code: string, start: number): string {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
    else if (depth === 0 && code.startsWith("/>", i)) return code.slice(start, i + 2);
  }

  return code.slice(start);
}

function silentlyDoubled(element: string): boolean {
  return /\{\s*value:\s*""\s*,\s*label:/.test(element) && !/\bplaceholder\b/.test(element);
}

/** Placeholders whose words are also an empty choice listed just above them. */
function doubled(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/placeholder="([^"]+)"/g)) {
    const before = code.slice(Math.max(0, (m.index ?? 0) - 800), m.index);
    const lastSelect = before.lastIndexOf("<Select");
    if (lastSelect === -1) continue;
    if (before.slice(lastSelect).includes(`{ value: "", label: "${m[1]}" }`)) out.push(m[1]);
  }

  return out;
}
