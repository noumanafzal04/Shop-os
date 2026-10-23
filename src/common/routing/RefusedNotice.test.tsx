import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { RequireAdminScreen, RequireFeature, RequireTenantScreen } from "./guards";
import { screenNameOf } from "../../layout/screenNames";
import { RefusedNotice } from "./RefusedNotice";
import { refusedWords } from "./refused";
import { useAuthStore } from "../../stores/authStore";

/**
 * B44 (the tester): a screen you may not use, typed in, landed silently on
 * the dashboard. The gate still sends you home — and home now says which
 * screen it was, and why.
 */
function visit(path: string, gate: React.ReactElement) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={gate}>
          <Route path="*" element={<div>the screen</div>} />
        </Route>
        <Route path="/tenant" element={<><RefusedNotice /><div>home</div></>} />
      </Routes>
    </MemoryRouter>,
  );
}

function signIn(permissions: string[], features: Record<string, boolean> = {}) {
  useAuthStore.setState({
    user: { id: "u1", name: "Bilal", role: "staff", permissions, branch_id: null, tenant: { features } } as never,
    isAuthenticated: true,
  });
}

afterEach(() => useAuthStore.setState({ user: null, isAuthenticated: false }));

describe("a screen that will not open says why", () => {
  it("names the screen a login does not include", () => {
    signIn(["sales.manage"]);
    visit("/tenant/staff", <RequireTenantScreen />);

    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.getByTestId("refused-notice")).toHaveTextContent("Staff list is not open to you");
    expect(screen.getByTestId("refused-notice")).toHaveTextContent("Ask the owner to give you access");
  });

  it("names a screen the shop does not have", () => {
    signIn(["expenses.manage"], { expenses: false });
    visit("/tenant/expenses", <RequireFeature feature="expenses" />);

    expect(screen.getByTestId("refused-notice")).toHaveTextContent("Expenses is not part of this shop");
  });

  it("says nothing when home was simply asked for", () => {
    signIn(["sales.manage"]);
    visit("/tenant", <RequireTenantScreen />);

    expect(screen.queryByTestId("refused-notice")).not.toBeInTheDocument();
  });

  it("names a screen by its own words when the menu does not hold it", () => {
    const named = (path: string) => refusedWords({ path, why: "permission" }).title;
    expect(named("/tenant/stock-transfers/new")).toBe("Stock transfers is not open to you");
    expect(named("/tenant")).toBe("That screen is not open to you");
  });

  /**
   * Next rounds #23: "Pos is not open to you", "Documents …" for the button the
   * menu calls Quotes & Advances. The notice now uses the menu's own name.
   */
  it("names a screen the way the menu does, in the shop's own trade", () => {
    const named = (path: string, trade = "retail") => refusedWords({ path, why: "permission" }, (p) => screenNameOf(p, trade)).title;
    expect(named("/tenant/pos")).toBe("POS is not open to you");
    expect(named("/tenant/documents")).toBe("Quotes & Advances is not open to you");
    expect(named("/tenant/day")).toBe("Day & banking is not open to you");
    expect(named("/tenant/stock-transfers/new")).toBe("Stock transfers is not open to you");
    expect(named("/admin/commission")).toBe("Commission is not open to you");
    expect(named("/tenant")).toBe("That screen is not open to you");
  });

  it("is said by the notice itself, from the menu", () => {
    signIn(["kitchen.manage"]);
    visit("/tenant/pos", <RequireTenantScreen />);
    expect(screen.getByTestId("refused-notice")).toHaveTextContent("POS is not open to you");
  });
});

/** Next rounds #26: 13 of 14 admin screens bounced to /admin and said nothing. */
describe("a platform screen that will not open says why", () => {
  it("lands on the admin dashboard naming the screen", () => {
    useAuthStore.setState({ user: { id: "a1", name: "Sana", role: "admin", permissions: ["banners.manage"] } as never, isAuthenticated: true });
    render(
      <MemoryRouter initialEntries={["/admin/tenants"]}>
        <Routes>
          <Route path="/admin/tenants" element={<RequireAdminScreen path="/admin/tenants" />}>
            <Route index element={<div>the screen</div>} />
          </Route>
          <Route path="/admin" element={<><RefusedNotice /><div>admin home</div></>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("admin home")).toBeInTheDocument();
    expect(screen.getByTestId("refused-notice")).toHaveTextContent("Tenants is not open to you");
  });
});
