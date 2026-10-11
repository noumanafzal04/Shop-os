import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

import CommandPalette from "./CommandPalette";

/**
 * ESCAPE CLOSES THE PALETTE — wherever the hand is.
 *
 * Found by a browser test that pressed Ctrl K and then Esc at once: the
 * palette stayed open. It heard Escape only inside its own box, and the box
 * takes the focus twenty milliseconds after it opens — so a key pressed in
 * between went to the page behind, and so did every Escape pressed after a
 * click anywhere else.
 */

vi.mock("../../../layout/AppSidebar", () => ({ useShopNav: () => [{ name: "Dashboard", path: "/tenant", icon: null }] }));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => `Rs ${n}` }));
vi.mock("../hooks/useGlobalSearch", () => ({ useGlobalSearch: () => ({ data: undefined, isFetching: false }) }));

function palette(open: boolean, onClose: () => void) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CommandPalette open={open} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the search palette and the Escape key", () => {
  it("closes when Escape is pressed BEFORE the box has taken the focus", () => {
    const onClose = vi.fn();
    palette(true, onClose);

    // Nothing inside the palette is focused yet: the key lands on the page.
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes once — not twice — when Escape is pressed inside the box", () => {
    const onClose = vi.fn();
    palette(true, onClose);

    const box = screen.getByRole("textbox", { name: "Search" });
    box.focus();
    fireEvent.keyDown(box, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("another key on the page behind closes nothing", () => {
    const onClose = vi.fn();
    palette(true, onClose);

    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "Enter" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("a palette that is shut is not listening", () => {
    const onClose = vi.fn();
    const { rerender } = palette(true, onClose);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CommandPalette open={false} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});
