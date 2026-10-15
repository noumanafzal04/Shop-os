import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import CloseShiftModal from "./CloseShiftModal";

/**
 * NOTHING COUNTED IS NOT A COUNT OF NOTHING.
 *
 * The till's banner says "Close shift", and so does this sheet's button. Two
 * presses closed a drawer that should have held 22,580 as counted at 0 — the
 * whole drawer booked short, on a shift nobody had counted. A box left
 * untouched is a count not yet made; an empty drawer is said with its own tick.
 */

let byNote = true;

vi.mock("../hooks/usePos", () => ({
  useSessionReport: () => ({
    data: { denomination_count: byNote, blind_close: false, declare_tenders: false, denominations: [1000, 500], drawer: { expected_cash: 22580 } },
  }),
}));
vi.mock("../../offline/tillSettings", () => ({
  tillFlag: (_c: unknown, _k: string, d: boolean) => d,
  useTillSettings: () => undefined,
  useTillCurrency: () => ({ code: "PKR", cash: [1000, 500] }),
}));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number) => String(n) }));

const closeButton = () => screen.getByRole("button", { name: "Close shift" });

function sheet() {
  const onSubmit = vi.fn();
  render(<CloseShiftModal isOpen onClose={() => {}} onSubmit={onSubmit} busy={false} />);
  return onSubmit;
}

beforeEach(() => {
  byNote = true;
});

describe("closing a shift nobody counted", () => {
  it("will not close on two presses with nothing counted", () => {
    const onSubmit = sheet();

    expect(closeButton(), "a drawer nobody counted could be closed as counted at 0").toBeDisabled();
    fireEvent.click(closeButton());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("close-shift-uncounted")).toHaveTextContent("Count the drawer first.");
  });

  it("closes on what was counted, note by note", () => {
    const onSubmit = sheet();
    fireEvent.change(screen.getByLabelText(/How many 1,000 notes/), { target: { value: "22" } });
    fireEvent.change(screen.getByLabelText(/How many 500 notes/), { target: { value: "1" } });

    expect(screen.queryByRole("checkbox", { name: /The drawer is empty/ }), "the empty-drawer tick is offered beside a count").toBeNull();
    fireEvent.click(closeButton());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ counted: 22500, denominations: { "1000": 22, "500": 1 } }));
  });

  it("closes an empty drawer only when it is said to be empty", () => {
    const onSubmit = sheet();
    fireEvent.click(screen.getByRole("checkbox", { name: /The drawer is empty/ }));

    expect(closeButton()).toBeEnabled();
    fireEvent.click(closeButton());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ counted: 0 }));
  });

  it("takes a typed 0 as a count, where the shop counts by total", () => {
    byNote = false;
    const onSubmit = sheet();
    expect(closeButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Counted cash"), { target: { value: "0" } });
    fireEvent.click(closeButton());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ counted: 0 }));
  });
});
