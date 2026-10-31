import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { useWrongBoxOpensItsTab } from "./wrongBoxOpensItsTab";
import type { FormTab } from "./formTabs";

/**
 * #AZ12 — a pack's "how many" set to −2 on Codes & packs, then Save pressed on
 * Details: nothing was sent, nothing was said, and the tab was not marked.
 */
function TwoTabs({ onSave }: { onSave: () => void }) {
  const [tab, setTab] = useState<FormTab>("details");
  const wrongBox = useWrongBoxOpensItsTab(tab, setTab);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(); }}
      onInvalidCapture={wrongBox}
    >
      <p>Open: {tab}</p>
      <div data-form-tab="details" hidden={tab !== "details"}>
        <input aria-label="Price" type="number" min="0" defaultValue="10" />
      </div>
      <div data-form-tab="advanced" hidden={tab !== "advanced"}>
        <input aria-label="How many" type="number" min="0" defaultValue="-2" />
      </div>
      <button type="submit">Save</button>
    </form>
  );
}

describe("a wrong box on a tab nobody is looking at", () => {
  it("opens that tab and points at the box, and nothing is saved", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(<TwoTabs onSave={onSave} />);

    act(() => { screen.getByRole("button", { name: "Save" }).closest("form")!.requestSubmit(); });
    await act(async () => { vi.runAllTimers(); });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Open: advanced")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("How many"));
    vi.useRealTimers();
  });

  it("on the open tab it leaves the browser to say it, and stays put", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(<TwoTabs onSave={onSave} />);
    const price = screen.getByLabelText("Price") as HTMLInputElement;
    price.value = "-1";
    (screen.getByLabelText("How many") as HTMLInputElement).value = "-2";

    act(() => { price.form!.requestSubmit(); });
    await act(async () => { vi.runAllTimers(); });

    expect(onSave).not.toHaveBeenCalled();
    // The first wrong box is on Details — the browser's own bubble is there.
    expect(screen.getByText("Open: details")).toBeTruthy();
    vi.useRealTimers();
  });

  it("the item form wires it: every pane says its tab, and the form listens", () => {
    const form = readFileSync(resolve(__dirname, "pages/ProductFormPage.tsx"), "utf8");

    expect(form).toMatch(/<form[^>]*onInvalidCapture=\{wrongBox\}/);
    for (const tab of ["details", "online", "options", "advanced"]) {
      expect(form).toContain(`data-form-tab="${tab}"`);
    }
  });
});
