import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * TAKING WORK IN (services #S2, #S6).
 *
 * With the line down the form let a laundry counter write out the whole slip,
 * then found no item and greyed out the button with no word why. And the
 * quantity box the hint promises was there, but nameless on screen.
 */
vi.mock("../../../components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../../../common/tenant/businessType", () => ({ usePrimaryBusinessType: () => "services" }));
vi.mock("../../catalog/services/catalogService", () => ({
  catalogService: { products: async () => ({ data: [{ id: "p1", name: "Shirt wash & press" }] }) },
}));
vi.mock("../../../common/hooks/useDebouncedValue", () => ({ useDebouncedValue: (v: string) => v }));
vi.mock("../../../components/ui/modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { BookInModal } from "./BookInModal";
import { useConnectionStore } from "../../../stores/connectionStore";

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BookInModal onClose={() => {}} onBooked={() => {}} />
    </QueryClientProvider>,
  );

afterEach(() => useConnectionStore.setState({ online: true, reachable: true }));

describe("taking work in", () => {
  it("says at the top, before anything is typed, that it needs the line", () => {
    useConnectionStore.setState({ online: false, reachable: true });
    show();

    expect(screen.getByRole("alert")).toHaveTextContent("Taking work in needs the internet");
    expect(screen.getByRole("button", { name: "Take it in" })).toBeDisabled();
  });

  it("a shop wifi with a dead uplink is offline too", () => {
    useConnectionStore.setState({ online: true, reachable: false });
    show();

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("will not take it in if the line drops after the slip is written", async () => {
    useConnectionStore.setState({ online: true, reachable: true });
    show();
    fireEvent.change(screen.getByPlaceholderText(/Search the work or an item/), { target: { value: "shirt" } });
    fireEvent.click(await screen.findByRole("button", { name: "Shirt wash & press" }));
    expect(screen.getByRole("button", { name: "Take it in" })).toBeEnabled();

    act(() => useConnectionStore.setState({ online: false }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take it in" })).toBeDisabled();
  });

  it("says nothing while the line is up", () => {
    useConnectionStore.setState({ online: true, reachable: true });
    show();

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
