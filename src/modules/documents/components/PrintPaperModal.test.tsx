import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PrintPaperModal } from "./PrintPaperModal";

/**
 * A reprint from the document asks which paper — with the shop's own choice
 * already picked, so one press prints as usual (the user, 2026-10-15).
 */
describe("printing a quotation from its page", () => {
  it("starts on the shop's paper, and one press prints on it", () => {
    const onPrint = vi.fn();
    render(<PrintPaperModal isOpen onClose={() => {}} shopPaper="thermal_80" onPrint={onPrint} />);

    expect(screen.getByRole("radio", { name: /80mm roll/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /A4 sheet/ })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(onPrint).toHaveBeenCalledWith("thermal_80");
  });

  it("prints one copy on another paper, and says Settings keeps the usual one", () => {
    const onPrint = vi.fn();
    render(<PrintPaperModal isOpen onClose={() => {}} shopPaper="standard" onPrint={onPrint} />);

    fireEvent.click(screen.getByRole("radio", { name: /58mm roll/ }));
    expect(screen.getByText(/For this copy only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(onPrint).toHaveBeenCalledWith("thermal_58");
  });

  it("opens on the shop's paper again, not on the last copy's", () => {
    const onPrint = vi.fn();
    const { rerender } = render(<PrintPaperModal isOpen onClose={() => {}} shopPaper="standard" onPrint={onPrint} />);
    fireEvent.click(screen.getByRole("radio", { name: /58mm roll/ }));

    rerender(<PrintPaperModal isOpen={false} onClose={() => {}} shopPaper="standard" onPrint={onPrint} />);
    rerender(<PrintPaperModal isOpen onClose={() => {}} shopPaper="standard" onPrint={onPrint} />);
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(onPrint).toHaveBeenLastCalledWith("standard");
  });
});
