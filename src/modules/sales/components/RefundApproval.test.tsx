import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RefundApproval } from "./RefundApproval";
import { NO_APPROVAL } from "../refundApproval";
import { useAuthStore } from "../../../stores/authStore";

/**
 * WHO MAY SAY YES, AND OUT OF WHICH DRAWER — for a void (Q18, 2026-10-17).
 *
 * A void is approved by somebody who may void, not by whoever may refund; and
 * its notes never go back out of no drawer (B86), so "no drawer" is not one
 * of the choices — and for a card sale there is no drawer to choose at all.
 */

vi.mock("../../pos/services/tillService", () => ({
  tillService: {
    roster: async () => ({
      data: [
        { id: "hina", name: "Hina", has_pin: true, pin_locked: false, approves_refunds: true, approves_voids: true },
        { id: "farah", name: "Farah", has_pin: true, pin_locked: false, approves_refunds: true, approves_voids: false },
      ],
    }),
  },
}));
vi.mock("../../registers/services/registerService", () => ({
  registerService: {
    shiftDay: async () => ({ data: { sessions: [{ id: "lane-1", status: "open", user: { id: "ayesha", name: "Ayesha" }, register: { name: "Lane 1" } }] } }),
  },
}));

const show = (props: Partial<Parameters<typeof RefundApproval>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RefundApproval needsApproval ownDrawer="open" value={NO_APPROVAL} onChange={() => {}} {...props} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  useAuthStore.setState({ user: { id: "me", role: "staff", permissions: ["sales.manage", "reports.view"], tenant: { features: { pos: true } } } } as never);
});

describe("approving a void", () => {
  it("offers only the people who may void", async () => {
    show({ purpose: "void" });

    const approvedBy = screen.getByRole("combobox", { name: "Approved by" });
    await waitFor(() => expect(within(approvedBy).getByRole("option", { name: "Hina" })).toBeInTheDocument());
    expect(within(approvedBy).queryByRole("option", { name: "Farah" })).not.toBeInTheDocument();
  });

  it("while a refund still offers whoever may refund", async () => {
    show();

    const approvedBy = screen.getByRole("combobox", { name: "Approved by" });
    await waitFor(() => expect(within(approvedBy).getByRole("option", { name: "Farah" })).toBeInTheDocument());
  });

  it("names a drawer, never 'no drawer', when the person has none open", async () => {
    show({ purpose: "void", ownDrawer: "none" });

    const drawer = screen.getByRole("combobox", { name: "Cash comes out of" });
    expect(within(drawer).getByRole("option", { name: "Choose the drawer it comes out of" })).toBeInTheDocument();
    expect(within(drawer).queryByRole("option", { name: /No drawer/ })).not.toBeInTheDocument();
    await waitFor(() => expect(within(drawer).getByRole("option", { name: /Ayesha's drawer/ })).toBeInTheDocument());
  });

  it("asks for no drawer when no notes go back across the counter", () => {
    show({ purpose: "void", ownDrawer: "none", drawerNeeded: false });

    expect(screen.queryByRole("combobox", { name: "Cash comes out of" })).not.toBeInTheDocument();
  });
});
