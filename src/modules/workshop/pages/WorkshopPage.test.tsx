import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

/**
 * THE BOARD, MADE EASY (the user, 2026-10-27).
 *
 * Every card offered "→" to every other stage, three look-alike buttons for
 * the one obvious thing. A card now offers its next step as one big button —
 * start the work, mark it ready, bill it — and the step back as a quiet link.
 * The late ones, which the phone calls are about, are one press away.
 */
const setWorkStatus = vi.fn(async () => ({ data: {} }));
let jobs: unknown[] = [];

vi.mock("../../../components/common/PageMeta", () => ({ default: () => null }));
vi.mock("../../../components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../../../common/tenant/businessType", () => ({ usePrimaryBusinessType: () => "automotive" }));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => String(n) }));
vi.mock("../../documents/services/documentService", () => ({
  documentService: {
    list: async () => ({ data: jobs, meta: { pagination: { last_page: 1 } } }),
    setWorkStatus: (...args: unknown[]) => setWorkStatus(...(args as [])),
  },
}));

import WorkshopPage from "./WorkshopPage";

const car = (id: string, plate: string, work_status: string, promised_at: string | null = null) => ({
  id,
  number: `JOB-${id}`,
  work_status,
  promised_at,
  total: "1000",
  customer_name: null,
  customer_phone: null,
  complaint: null,
  vehicle: { registration: plate, make: "Toyota", model: "Corolla" },
});

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/tenant/workshop"]}>
        <WorkshopPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const cardOf = async (plate: string) => (await screen.findByRole("button", { name: plate })).closest("div.rounded-xl") as HTMLElement;

beforeEach(() => setWorkStatus.mockClear());

describe("the workshop board", () => {
  it("a waiting car offers one press forward, and nothing back", async () => {
    jobs = [car("1", "LEA-1", "received")];
    show();
    const card = await cardOf("LEA-1");

    expect(within(card).queryByRole("button", { name: /Back to/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /Mark ready/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /Start work/ }));

    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith("1", "in_progress"));
  });

  it("a car being worked on is marked ready, or goes back to waiting", async () => {
    jobs = [car("2", "LEA-2", "in_progress")];
    show();
    const card = await cardOf("LEA-2");

    fireEvent.click(within(card).getByRole("button", { name: /Mark ready/ }));
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith("2", "ready"));

    const back = within(card).getByRole("button", { name: "Back to Waiting" });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith("2", "received"));
  });

  it("a ready car's next step is the bill — and a failed road test sends it back", async () => {
    jobs = [car("3", "LEA-3", "ready")];
    show();
    const card = await cardOf("LEA-3");

    expect(within(card).getByRole("link", { name: "Bill it" })).toHaveAttribute("href", "/tenant/documents/3");
    expect(within(card).queryByRole("button", { name: /Start work|Mark ready/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /Back to Work in progress/ }));

    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith("3", "in_progress"));
  });

  it("one press shows only the late cars, and one more shows them all", async () => {
    jobs = [car("4", "LATE-1", "in_progress", "2020-01-01T10:00:00Z"), car("5", "ONTIME-1", "in_progress", "2999-01-01T10:00:00Z")];
    show();
    await cardOf("ONTIME-1");

    fireEvent.click(screen.getByRole("button", { name: "1 late — show only these" }));
    expect(screen.queryByRole("button", { name: "ONTIME-1" })).toBeNull();
    expect(screen.getByRole("button", { name: "LATE-1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all cars" }));
    expect(screen.getByRole("button", { name: "ONTIME-1" })).toBeInTheDocument();
  });

  it("Start work, Mark ready and Bill it never look alike", async () => {
    jobs = [car("7", "LEA-7", "received"), car("8", "LEA-8", "in_progress"), car("9", "LEA-9", "ready")];
    show();
    const colour = (el: HTMLElement) => el.className.split(" ").find((c) => /^bg-(?!opacity)/.test(c));
    const start = within(await cardOf("LEA-7")).getByRole("button", { name: /Start work/ });
    const ready = within(await cardOf("LEA-8")).getByRole("button", { name: /Mark ready/ });
    const bill = within(await cardOf("LEA-9")).getByRole("link", { name: "Bill it" });

    expect(new Set([colour(start), colour(ready), colour(bill)]).size).toBe(3);
  });

  it("has no back button of its own at the top", async () => {
    jobs = [car("6", "LEA-6", "received")];
    show();
    await cardOf("LEA-6");

    expect(screen.queryByRole("button", { name: "← Back" })).toBeNull();
  });
});
