import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import PricingVariancesPanel from "./PricingVariancesPanel";
import { verdict } from "./verdict";
import { varianceService, type ShadowChecks } from "./varianceService";

/**
 * Whether this shop's tills can be trusted to price on their own.
 *
 * The one thing this screen must never do is show a clean sheet a shop did not
 * earn. "No disagreements" is produced identically by a shop whose engine
 * agreed on 1,284 real carts and by a shop where no till ever checked anything
 * — and the second is the quieter of the two. Every test here is about keeping
 * those apart.
 */

const checks = (over: Partial<ShadowChecks> = {}): ShadowChecks => ({
  checked: 1284,
  matched: 1284,
  skipped: 0,
  differed: 0,
  tills: 2,
  reporting: 2,
  since: "2026-08-01T00:00:00.000Z",
  ...over,
});

const finding = () => ({
  id: "v1",
  sale_id: "s1",
  found_at: "2026-08-13T10:00:00.000Z",
  device: { id: "d1", name: "Lane 1" },
  server: { subtotal: 100, discount: 0, tax: 17, total: 117 },
  local: { subtotal: 100, discount: 0, tax: 17.01, total: 117.01 },
  differences: [{ field: "tax", server: 17, local: 17.01, by: 0.01 }],
  cart: {},
});

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

function show(data: { checks: ShadowChecks; total: number; variances: ReturnType<typeof finding>[] }) {
  vi.spyOn(varianceService, "list").mockResolvedValue(envelope(data) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <PricingVariancesPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("the verdict", () => {
  it("reports having checked NOTHING before reporting having found nothing", async () => {
    // The load-bearing test in this file. A shop that has checked nothing must
    // never be shown "no disagreements".
    const state = verdict(checks({ checked: 0, matched: 0 }), 0);

    expect(state.tone).toBe("warning");
    expect(state.headline).toMatch(/nothing checked/i);
  });

  it("says so plainly on screen, rather than showing a clean sheet", async () => {
    show({ checks: checks({ checked: 0, matched: 0 }), total: 0, variances: [] });

    expect(await screen.findByText(/Nothing checked yet/)).toBeInTheDocument();
    expect(screen.queryByText(/^No disagreements$/)).toBeNull();
  });

  it("distinguishes a shop with no tills from a shop whose tills have not sold", async () => {
    // "Nobody has switched a till on" and "your tills have sold nothing
    // checkable" call for different next actions, so they get different words.
    expect(verdict(checks({ checked: 0, tills: 0, reporting: 0 }), 0).detail)
      .toMatch(/No till has opened the POS/i);
    expect(verdict(checks({ checked: 0, tills: 3, reporting: 0 }), 0).detail)
      .toMatch(/have not rung a sale/i);
  });

  it("passes only when something was checked AND nothing was found", async () => {
    const state = verdict(checks(), 0);

    expect(state.tone).toBe("success");
    expect(state.detail).toMatch(/1,284/);
  });

  it("fails on a single finding, however many carts agreed", async () => {
    // One wrong receipt is the whole reason the exercise exists.
    const state = verdict(checks({ checked: 50_000, differed: 1 }), 1);

    expect(state.tone).toBe("error");
    expect(state.headline).toMatch(/1 cart priced differently/);
  });

  it("says nobody was mis-billed, because nobody was", async () => {
    expect(verdict(checks(), 3).detail).toMatch(/server's price/);
  });
});

describe("the denominator", () => {
  it("is always on screen beside the finding count", async () => {
    show({ checks: checks({ checked: 1284, matched: 1280, skipped: 4 }), total: 0, variances: [] });

    // Scoped to its own figure: "1,284" would otherwise also match the matched
    // count in a shop where every check agreed, and the assertion would pass
    // without the label and the number belonging to each other.
    const checked = (await screen.findByText("Carts checked")).parentElement;
    expect(checked).toHaveTextContent("1,284");
    expect(screen.getByText("Couldn't be priced").parentElement).toHaveTextContent("4");
  });

  it("says how much of the fleet has actually been exercised", async () => {
    show({ checks: checks({ tills: 4, reporting: 1 }), total: 0, variances: [] });

    expect(await screen.findByText("1 of 4")).toBeInTheDocument();
    expect(screen.getByText(/does not cover them/)).toBeInTheDocument();
  });

  it("does not nag when every till is reporting", async () => {
    show({ checks: checks({ tills: 2, reporting: 2 }), total: 0, variances: [] });

    await screen.findByText("Carts checked");
    expect(screen.queryByText(/does not cover them/)).toBeNull();
  });

  it("warns when most carts could not be priced at all", async () => {
    // A skip is not a match. Nine in ten skipped means the till's catalog is
    // incomplete — which a bare "no disagreements" would hide completely.
    show({ checks: checks({ checked: 1000, matched: 100, skipped: 900 }), total: 0, variances: [] });

    expect(await screen.findByText(/90% of carts couldn't be priced/)).toBeInTheDocument();
  });

  it("stays quiet when skips are a normal trickle", async () => {
    show({ checks: checks({ checked: 1000, matched: 995, skipped: 5 }), total: 0, variances: [] });

    await screen.findByText("Carts checked");
    expect(screen.queryByText(/couldn't be priced locally at all/)).toBeNull();
  });

  it("warns that the window can go backwards, because it can", async () => {
    show({ checks: checks(), total: 0, variances: [] });

    expect(await screen.findByText(/go down as well as up/)).toBeInTheDocument();
  });
});

describe("the findings themselves", () => {
  it("shows which till, and what the two engines each said", async () => {
    show({ checks: checks({ differed: 1 }), total: 1, variances: [finding()] });

    expect(await screen.findByText("Lane 1")).toBeInTheDocument();
    expect(screen.getByText(/server Rs 17.00, till Rs 17.01/)).toBeInTheDocument();
  });

  it("says when it is showing only the newest few", async () => {
    show({ checks: checks({ differed: 300 }), total: 300, variances: [finding()] });

    expect(await screen.findByText(/newest 1 of 300/)).toBeInTheDocument();
  });

  it("says so when the report cannot be loaded", async () => {
    vi.spyOn(varianceService, "list").mockRejectedValue(new Error("nope"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PricingVariancesPanel />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Couldn't load the pricing checks/)).toBeInTheDocument();
  });
});
