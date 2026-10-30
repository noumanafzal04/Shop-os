import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CollectModal } from "./CollectModal";

/**
 * B26: Bill & hand over showed the balance only as a grey placeholder, and
 * "Bill it" stayed shut until the same figure was typed over it.
 */
vi.mock("../../pos/hooks/useCounterShift", () => ({ useCounterShift: () => ({ ready: true, why: null }), useCashReachesNoDrawer: () => null }));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number) => `Rs ${n.toLocaleString("en-US")}` }));

const show = (onSubmit = vi.fn(), onClose = vi.fn(), balance = 2490) =>
  render(
    <CollectModal isOpen onClose={onClose} balance={balance} layaway pending={false} odometerIn={null} asksOdometer={false} onSubmit={onSubmit} />,
  );

describe("billing and handing over", () => {
  it("starts with the balance taken, so the commonest answer is one press", () => {
    const onSubmit = vi.fn();
    show(onSubmit);

    expect(screen.getByRole("spinbutton")).toHaveValue(2490);
    fireEvent.click(screen.getByRole("button", { name: "Bill it" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ payment_method: "cash", amount_paid: 2490 }));
  });

  it("still refuses less than the balance, and says by how much", () => {
    show();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2000" } });

    expect(screen.getByRole("button", { name: "Bill it" })).toBeDisabled();
    expect(screen.getByText("Rs 490 short of the balance.")).toBeInTheDocument();
  });

  it("opens on the balance again after a cancel, not on what was typed", () => {
    const onClose = vi.fn();
    const { rerender } = show(vi.fn(), onClose);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();

    rerender(<CollectModal isOpen onClose={onClose} balance={2490} layaway pending={false} odometerIn={null} asksOdometer={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole("spinbutton")).toHaveValue(2490);
  });

  it("asks for nothing when nothing is owed", () => {
    show(vi.fn(), vi.fn(), 0);

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bill it" })).toBeEnabled();
  });
});
