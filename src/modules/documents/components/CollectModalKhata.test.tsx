import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * A BILL CAN GO ON THE CUSTOMER'S KHATA (services #S3).
 *
 * The final bill offered the advance's tenders — and an advance can never be
 * on credit — so a laundry could not bill a hostel monthly, nor a distributor
 * a dealer, from any screen, although the server did it happily.
 */
vi.mock("../../pos/hooks/useCounterShift", () => ({ useCounterShift: () => ({ ready: true, why: null }), useCashReachesNoDrawer: () => null }));
vi.mock("../../pos/components/ShiftNeeded", () => ({ ShiftNeeded: () => null }));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number) => `M${n}` }));
vi.mock("../../../components/ui/modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalForm: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => <div>{children}{footer}</div>,
}));

import { CollectModal } from "./CollectModal";

const show = (khata: boolean, onSubmit = vi.fn()) => {
  render(
    <CollectModal isOpen onClose={() => {}} balance={3510} layaway={false} pending={false}
      odometerIn={null} asksOdometer={false} khata={khata} onSubmit={onSubmit} />,
  );
  return onSubmit;
};

describe("billing a job or a quotation", () => {
  it("puts the whole balance on the customer's khata", () => {
    const sent = show(true);

    // A smaller figure typed for cash first does not shrink what goes on khata.
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Khata" }));
    expect(screen.getByText(/goes on the customer's khata/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bill it" }));

    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ payment_method: "credit", amount_paid: 3510 }));
  });

  it("offers no khata where the shop, the person or the document cannot have one", () => {
    show(false);

    expect(screen.queryByRole("button", { name: "Khata" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cash" })).toBeInTheDocument();
  });
});
