import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { useAuthStore } from "../../stores/authStore";

/**
 * A SHOP THAT CAN ONLY READ SAYS SO ON EVERY SCREEN (admin #AD2).
 *
 * The dashboard and the till said "Read-only"; Products, Expenses, Sales and
 * Inventory said nothing and still offered "+ Add Item".
 */
function shop(state: "active" | "grace" | "read_only", role = "shop_owner", permissions: string[] = []) {
  useAuthStore.setState({ user: { role, permissions, tenant: { subscription_state: state } } } as never);

  return render(
    <MemoryRouter>
      <ReadOnlyBanner />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null } as never);
});

describe("the read-only banner", () => {
  it("says the shop can only read, and sends the owner to renew", () => {
    shop("read_only");

    expect(screen.getByRole("status")).toHaveTextContent("Read-only — this shop's plan has ended");
    expect(screen.getByRole("link", { name: "Renew" })).toHaveAttribute("href", "/tenant/subscription");
  });

  it("does not send a cashier to a page they cannot open", () => {
    shop("read_only", "staff", ["sales.manage"]);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Renew" })).toBeNull();
  });

  it("is not there while the shop can still work — paid or in grace", () => {
    shop("active");
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();

    shop("grace");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is drawn by the shell, above every shop screen — not by one page", () => {
    const layout = readFileSync(resolve(__dirname, "../../layout/AppLayout.tsx"), "utf8");
    expect(layout).toMatch(/<DemoBanner \/>\s*<ReadOnlyBanner \/>\s*<AppHeader \/>/);
  });
});
