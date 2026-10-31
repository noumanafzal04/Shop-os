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
let expectedCash = 22580;

vi.mock("../hooks/usePos", () => ({
  useSessionReport: () => ({
    data: { denomination_count: byNote, blind_close: false, declare_tenders: false, denominations: [1000, 500], drawer: { expected_cash: expectedCash } },
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
  expectedCash = 22580;
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

describe("counting to the paisa (the full re-test, #9)", () => {
  it("adds the loose paisa to the notes, and says them apart", () => {
    const onSubmit = sheet();
    fireEvent.change(screen.getByLabelText(/How many 1,000 notes/), { target: { value: "22" } });
    fireEvent.change(screen.getByLabelText("Loose cash"), { target: { value: "79.50" } });

    fireEvent.click(closeButton());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ counted: 22079.5, denominations: { "1000": 22 }, loose: 79.5 }));
  });

  it("is a count on its own, and keeps money as money — one point, two places", () => {
    const onSubmit = sheet();
    const box = screen.getByLabelText("Loose cash");
    fireEvent.change(box, { target: { value: "0.5x55" } });
    expect(box).toHaveValue("0.55");

    fireEvent.click(closeButton());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ counted: 0.55, denominations: undefined, loose: 0.55 }));
  });

  it("sends no loose figure when there is none", () => {
    const onSubmit = sheet();
    fireEvent.change(screen.getByLabelText(/How many 500 notes/), { target: { value: "2" } });

    fireEvent.click(closeButton());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ counted: 1000, loose: undefined }));
  });
});

/**
 * #AZ14 — a till paid out beyond what it held: AED 200 float, 152.25 taken, a
 * supplier paid 1,000 and an expense 120.50 in cash. Expected −668.00; counted
 * 0; the sheet said "Over 668.00" beside "The drawer is empty".
 */
describe("a drawer paid out beyond what it held", () => {
  it("does not call the empty drawer a surplus, and says where to look", () => {
    byNote = false;
    expectedCash = -668;
    sheet();
    fireEvent.click(screen.getByRole("checkbox", { name: /The drawer is empty/ }));

    expect(screen.queryByText("Over")).toBeNull();
    expect(screen.getByText("Paid out beyond what it held")).toBeInTheDocument();
    expect(document.querySelector("[data-drawer-overdrawn]")).toHaveTextContent("668 came from somewhere");
  });

  it("an ordinary surplus is still Over", () => {
    byNote = false;
    expectedCash = 100;
    sheet();
    fireEvent.change(screen.getByLabelText("Counted cash"), { target: { value: "150" } });

    expect(screen.getByText("Over")).toBeInTheDocument();
    expect(document.querySelector("[data-drawer-overdrawn]")).toBeNull();
  });
});
