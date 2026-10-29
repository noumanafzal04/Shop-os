import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";

/**
 * A NO REACHES THE SHOP (admin #AD6).
 *
 * The admin declined a keep-request with a reason; the shop read "no request"
 * and the banner offered "Keep this shop" as if nobody had ever asked.
 */
const answer = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("../../../common/api/client", () => ({ apiGet: async () => ({ data: answer.data }) }));
vi.mock("./KeepShopModal", () => ({ default: () => null }));

import DemoBanner from "./DemoBanner";

function demo() {
  useAuthStore.setState({
    user: { tenant: { is_demo: true, demo_expires_at: "2099-10-29T19:00:00" } },
  } as never);

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DemoBanner />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null } as never);
});

describe("the demo banner", () => {
  it("declined: says so, with the reason, and offers to ask again", async () => {
    answer.data = { id: "r1", status: "declined", decline_reason: "Duplicate of an existing shop" };
    demo();

    expect(await screen.findByText(/We could not keep this shop: Duplicate of an existing shop\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask again" })).toBeInTheDocument();
  });

  it("waiting: says the request is in, and offers nothing", async () => {
    answer.data = { id: "r1", status: "pending", decline_reason: null };
    demo();

    expect(await screen.findByText(/We have your request/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("never asked: offers to keep it, and says when it ends the shop's way", async () => {
    answer.data = null;
    demo();

    expect(await screen.findByRole("button", { name: "Keep this shop" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/at \w{3} 7:00 PM/);
  });
});
