import { describe, expect, it } from "vitest";

/**
 * THE DRAWER NEVER SHOWS A FIGURE FROM BEFORE THE LAST SALE.
 *
 * Found by the first browser test that lived through a whole shift: two sales
 * rung, the Drawer sheet opened, and it read "Expected Rs 2,000 · Sales 0" —
 * the X-read from before either sale. The hook said `staleTime: 0`, which
 * refetches on open but DRAWS THE OLD DATA until the answer lands, and keeps
 * drawing it if the answer never does. The count sheet shares the hook, so a
 * shift could be counted against a stale expectation.
 *
 * The browser spec (`e2e/till-drawer.spec.ts`) reads the figure the instant
 * the sheet is up, which is the real proof. This is the cheap one that fails
 * in a second if somebody "tidies" the option away.
 */

const HOOKS = Object.values(
  import.meta.glob("./hooks/usePos.ts", { query: "?raw", import: "default", eager: true }),
)[0] as string;

describe("the X-read hook", () => {
  const hook = HOOKS.slice(HOOKS.indexOf("export function useSessionReport"), HOOKS.indexOf("export function useCashMovementMutation"));

  it("is found", () => {
    expect(hook.length).toBeGreaterThan(50);
  });

  it("refetches whenever a sheet opens", () => {
    expect(hook).toMatch(/staleTime: 0,/);
  });

  it("keeps nothing once the last sheet closes — so there is no old figure to draw", () => {
    expect(hook).toMatch(/gcTime: 0,/);
  });

  it("withholds the figure while a new one is on its way", () => {
    /**
     * The one that actually fixes it. The sheets stay mounted while shut, so
     * their observer keeps the old report alive whatever `gcTime` says — the
     * first attempt set only that, and the browser spec still read Rs 2,000.
     */
    expect(hook).toMatch(/data: waiting \? undefined : query\.data,/);
    expect(hook).toMatch(/isPending: query\.isPending \|\| waiting,/);
    expect(hook).toMatch(/const waiting = query\.isFetching;/);
  });

  it("is the one both sheets read, so neither can hold its own copy", () => {
    const sources = import.meta.glob("./components/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const readers = Object.entries(sources).filter(([, src]) => /useSessionReport\(/.test(src)).map(([file]) => file.split("/").pop());

    expect(readers.sort()).toEqual(["CashDrawerPanel.tsx", "CloseShiftModal.tsx"]);
    // And nobody asks the endpoint behind the hook's back.
    for (const [file, src] of Object.entries(sources)) {
      expect(src, `${file} calls the X-read directly`).not.toMatch(/posService\.sessionReport\(/);
    }
  });
});
