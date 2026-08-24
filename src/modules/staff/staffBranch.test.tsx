import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import BranchSwitcher from "../branches/components/BranchSwitcher";
import { useAuthStore } from "../../stores/authStore";
import type { User } from "../auth/types";

/**
 * WHICH BRANCH AM I STANDING IN?
 *
 * `ResolveBranch` pins a staff member to `users.branch_id` and a header can
 * never move them, so they were never WRONG about which branch they were on —
 * they simply could not know. This control returned null for anyone who was not
 * an owner and nothing else on any screen named the branch, which on a
 * two-branch shop means the person counting a drawer has no way to check whose
 * drawer it is.
 *
 * Read-only on purpose: the pin is the owner's decision, taken on the staff
 * screen. A switch the server ignores would be worse than silence.
 */

const shop = (maxBranches: number) => ({
  success: true, message: "", errors: {}, meta: {},
  data: { max_branches: maxBranches },
});

const branches = {
  success: true, message: "", errors: {}, meta: {},
  data: [
    { id: "b1", name: "Main", is_active: true },
    { id: "b2", name: "Saddar", is_active: true },
  ],
};

vi.mock("../../common/api/client", () => ({
  apiGet: vi.fn((url: string) => {
    if (url.startsWith("/shop/settings")) return Promise.resolve(shop(3));
    if (url.startsWith("/branches")) return Promise.resolve(branches);
    return Promise.resolve({ success: true, message: "", errors: {}, meta: {}, data: null });
  }),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

const person = (over: Partial<User>): User => ({
  id: "u1", name: "Someone", email: null, phone: null, role: "staff",
  status: "active", permissions: ["sales.manage"], branch_id: null,
  email_verified: true, phone_verified: true, last_login_at: null,
  created_at: "2026-08-24T00:00:00Z", ...over,
});

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={qc}>
      <BranchSwitcher />
    </QueryClientProvider>,
  );
}

beforeEach(() => useAuthStore.setState({ isAuthenticated: true }));
afterEach(() => useAuthStore.setState({ user: null, isAuthenticated: false }));

describe("a staff member is told where they are", () => {
  it("names the branch they are pinned to", async () => {
    useAuthStore.setState({ user: person({ branch_id: "b2" }) });
    show();

    await waitFor(() => expect(screen.getByText("Saddar")).toBeInTheDocument());
  });

  it("gives them no way to change it", async () => {
    // The pin is the owner's decision and the server ignores a header from
    // staff. A control that looks like a switch and does nothing is worse than
    // no control.
    useAuthStore.setState({ user: person({ branch_id: "b2" }) });
    show();

    await waitFor(() => expect(screen.getByText("Saddar")).toBeInTheDocument());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says nothing when the shop has one branch", async () => {
    useAuthStore.setState({ user: person({ branch_id: "b2" }) });
    // A single-branch shop: the name would be furniture.
    const { apiGet } = (await import("../../common/api/client")) as unknown as {
      apiGet: ReturnType<typeof vi.fn>;
    };
    apiGet.mockImplementation((url: string) =>
      url.startsWith("/shop/settings") ? Promise.resolve(shop(1)) : Promise.resolve(branches));

    const { container } = show();

    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
