import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

import KitchenPage from "./KitchenPage";
import { kitchenService, type KitchenBoard, type KotCard } from "../services/kitchenService";
import { ConfirmProvider } from "../../../components/ui/confirm";

/**
 * THE KITCHEN BOARD — what it puts where, and what one press clears.
 *
 * The server decides WHICH tickets are tonight's (ThePassIsTonightsTest holds
 * that). What is held here is what the screen does with the answer: a ticket
 * is in the lane its stage says, a leftover is counted and never mixed in, and
 * a clear asks first and then asks for exactly the pile it named.
 */

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("../../../components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("../../../components/common/PageMeta", () => ({ default: () => null }));

let n = 0;
const kot = (over: Partial<KotCard> = {}): KotCard => ({
  id: `k${++n}`, kot_number: 1, station: null, status: "fired", notes: null,
  fired_at: null, preparing_at: null, ready_at: null, served_at: null,
  age_seconds: 30, ticket_number: "TAB-1", table_name: "T1", order_type: "dine_in", guest_count: 2,
  items: [{ name: "Chicken Karahi", quantity: 1, modifiers: [], note: null }],
  ...over,
});

const board = (kots: KotCard[], over: Partial<KitchenBoard> = {}): KitchenBoard => ({
  kots,
  stations: [...new Set(kots.map((k) => k.station).filter((s): s is string => s !== null))].sort(),
  older: { count: 0, oldest_fired_at: null },
  service_began: "2026-10-06T00:00:00.000Z",
  server_time: "2026-10-06T15:00:00.000Z",
  ...over,
});

const envelope = <T,>(data: T, message = "") => ({ success: true, message, data, errors: {}, meta: {} });

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <KitchenPage />
        </ConfirmProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** A lane is a region named for its stage and how much it holds. */
const lane = (name: RegExp) => screen.getByRole("region", { name });

beforeEach(() => {
  vi.restoreAllMocks();
  toast.success.mockClear();
  toast.error.mockClear();
  localStorage.clear();
});

describe("a ticket is in the lane its stage says", () => {
  it("puts new, cooking and ready each in their own queue", async () => {
    vi.spyOn(kitchenService, "board").mockResolvedValue(envelope(board([
      kot({ table_name: "T1", status: "fired" }),
      kot({ table_name: "T2", status: "fired" }),
      kot({ table_name: "T3", status: "preparing" }),
      kot({ table_name: "T4", status: "ready" }),
    ])));

    renderBoard();

    await screen.findByRole("heading", { name: "T1" });
    expect(within(lane(/^New — 2 tickets/)).getAllByRole("article")).toHaveLength(2);
    expect(within(lane(/^Cooking — 1 ticket$/)).getByRole("heading", { name: "T3" })).toBeInTheDocument();
    expect(within(lane(/^Ready — 1 ticket$/)).getByRole("heading", { name: "T4" })).toBeInTheDocument();
  });

  it("offers each ticket the one press that moves it on, and sends it", async () => {
    vi.spyOn(kitchenService, "board").mockResolvedValue(envelope(board([
      kot({ id: "new", table_name: "T1", status: "fired" }),
      kot({ id: "hot", table_name: "T3", status: "preparing" }),
      kot({ id: "up", table_name: "T4", status: "ready" }),
    ])));
    const bump = vi.spyOn(kitchenService, "bump").mockResolvedValue(envelope(kot()));

    renderBoard();
    await screen.findByRole("heading", { name: "T1" });

    await userEvent.click(within(lane(/^New/)).getByRole("button", { name: "Start cooking" }));
    await userEvent.click(within(lane(/^Cooking/)).getByRole("button", { name: "Ready" }));
    await userEvent.click(within(lane(/^Ready/)).getByRole("button", { name: "Served" }));

    expect(bump.mock.calls).toEqual([["new", "preparing"], ["hot", "ready"], ["up", "served"]]);
  });

  it("narrows to a station without asking the server again, and counts every station", async () => {
    const read = vi.spyOn(kitchenService, "board").mockResolvedValue(envelope(board([
      kot({ table_name: "T1", station: "Grill" }),
      kot({ table_name: "T2", station: "Grill" }),
      kot({ table_name: "T3", station: "Bar" }),
    ])));

    renderBoard();
    await screen.findByRole("heading", { name: "T1" });

    // Every tab says how much is behind it — which the screen could not do
    // while picking a station fetched that station and nothing else.
    expect(screen.getByRole("button", { name: "All stations, 3 tickets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grill, 2 tickets" })).toBeInTheDocument();
    const calls = read.mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: "Bar, 1 ticket" }));

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "T3" })).toBeInTheDocument();
    expect(read.mock.calls.length, "switching station went back to the server").toBe(calls);
  });
});

describe("what an earlier service left behind", () => {
  const leftovers = { count: 7, oldest_fired_at: "2026-10-01T16:15:00.000Z" };

  it("says nothing when there is nothing left over", async () => {
    vi.spyOn(kitchenService, "board").mockResolvedValue(envelope(board([kot()])));

    renderBoard();
    await screen.findByRole("heading", { name: "T1" });

    expect(screen.queryByTestId("kitchen-older")).not.toBeInTheDocument();
  });

  it("counts them at the top and keeps them out of tonight's lanes", async () => {
    vi.spyOn(kitchenService, "board").mockResolvedValue(envelope(board([kot()], { older: leftovers })));

    renderBoard();

    const strip = await screen.findByTestId("kitchen-older");
    expect(strip).toHaveTextContent("7 tickets are left from before today's service");
    expect(strip).toHaveTextContent("Not shown below");
    // Tonight's one ticket, and only that.
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("clears them in one press — after asking, and asking for that pile only", async () => {
    vi.spyOn(kitchenService, "board").mockResolvedValue(envelope(board([kot()], { older: leftovers })));
    const clear = vi.spyOn(kitchenService, "clear").mockResolvedValue(envelope({ cleared: 7 }, "7 tickets cleared."));

    renderBoard();
    await userEvent.click(within(await screen.findByTestId("kitchen-older")).getByRole("button", { name: "Clear all 7" }));

    // It asks first. Nothing has gone anywhere yet.
    const ask = await screen.findByRole("dialog");
    expect(ask).toHaveTextContent("Clear 7 tickets left from before today?");
    expect(ask).toHaveTextContent("not as served");
    expect(clear).not.toHaveBeenCalled();

    await userEvent.click(within(ask).getByRole("button", { name: "Clear 7 tickets" }));

    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    // The leftovers — never tonight's board, and never one station of it.
    expect(clear).toHaveBeenCalledWith("older", undefined);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("7 tickets cleared."));
  });

  it("does nothing if the answer is no", async () => {
    vi.spyOn(kitchenService, "board").mockResolvedValue(envelope(board([kot()], { older: leftovers })));
    const clear = vi.spyOn(kitchenService, "clear").mockResolvedValue(envelope({ cleared: 7 }));

    renderBoard();
    await userEvent.click(within(await screen.findByTestId("kitchen-older")).getByRole("button", { name: "Clear all 7" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(clear).not.toHaveBeenCalled();
  });

  it("shows them on their own when asked, by asking the server for exactly them", async () => {
    const read = vi.spyOn(kitchenService, "board").mockImplementation(async (view) =>
      envelope(view === "older"
        ? board([kot({ table_name: "Old T9", age_seconds: 5 * 86_400 + 3 * 3_600 })])
        : board([kot({ table_name: "T1" })], { older: { count: 1, oldest_fired_at: leftovers.oldest_fired_at } })),
    );

    renderBoard();
    await userEvent.click(within(await screen.findByTestId("kitchen-older")).getByRole("button", { name: "Show them" }));

    expect(await screen.findByRole("heading", { name: "Old T9" })).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith("older");
    // In DAYS. "123h" is not a thing anybody reads as "last Thursday".
    expect(screen.getByText("5d 3h")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "T1" })).not.toBeInTheDocument();
  });
});

describe("clearing the board at close", () => {
  it("is not offered on an empty board", async () => {
    vi.spyOn(kitchenService, "board").mockResolvedValue(envelope(board([])));

    renderBoard();

    expect(await screen.findByText("Every order is out.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear board" })).not.toBeInTheDocument();
  });

  it("names how many, and clears tonight's board — one station's if one is chosen", async () => {
    vi.spyOn(kitchenService, "board").mockResolvedValue(envelope(board([
      kot({ table_name: "T1", station: "Grill" }),
      kot({ table_name: "T2", station: "Grill" }),
      kot({ table_name: "T3", station: "Bar" }),
    ])));
    const clear = vi.spyOn(kitchenService, "clear").mockResolvedValue(envelope({ cleared: 2 }, "2 tickets cleared."));

    renderBoard();
    await screen.findByRole("heading", { name: "T1" });
    await userEvent.click(screen.getByRole("button", { name: "Grill, 2 tickets" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear board" }));

    const ask = await screen.findByRole("dialog");
    // The grill clearing down does not clear the bar, and the question says so.
    expect(ask).toHaveTextContent("Clear all 2 tickets off the Grill board?");
    await userEvent.click(within(ask).getByRole("button", { name: "Clear 2 tickets" }));

    await waitFor(() => expect(clear).toHaveBeenCalledWith("board", "Grill"));
  });
});
