import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { progressSaid } from "../importFile";
import { ImportProgress } from "./ImportProgress";

/**
 * The user, 2026-11-01: "processing show hoti hai real time jb itne size ki
 * products upload hoti hain?" — it did, as a grey line in a corner. The bar
 * says the rows in out of the whole file, the percent and the time left, to a
 * screen reader as well as to the eye.
 */
describe("a long import is shown as it goes", () => {
  const start = 1_000_000;
  const p = progressSaid({ doing: "Bringing in", done: 12500, total: 50010, part: 26, parts: 101, startedAt: start }, start + 90_000);

  it("says the rows in out of the file, the percent and the time left", () => {
    render(<ImportProgress p={p} />);
    const box = screen.getByTestId("import-progress");
    expect(box.textContent).toContain("Bringing in 12,500 / 50,010 rows · 24%");
    expect(box.textContent).toContain("about 5 min left");
    expect(box.textContent).toContain("Part 26 of 101");
    expect(box.textContent).toContain("Keep this page open");
  });

  it("is a progress bar a screen reader can read, filled to the percent", () => {
    render(<ImportProgress p={p} />);
    const bar = screen.getByRole("progressbar", { name: "Bringing the items in" });
    expect(bar.getAttribute("aria-valuenow")).toBe("24");
    expect(bar.getAttribute("aria-valuetext")).toBe("12,500 / 50,010 rows · 24%");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("24%");
  });

  it("says no time left before there is a pace to judge it by", () => {
    render(<ImportProgress p={progressSaid({ doing: "Checking", done: 0, total: 50010, part: 1, parts: 101, startedAt: start }, start)} />);
    expect(screen.getByRole("progressbar", { name: "Checking the file" }).getAttribute("aria-valuenow")).toBe("0");
    expect(screen.queryByText(/left$/)).toBeNull();
  });
});
