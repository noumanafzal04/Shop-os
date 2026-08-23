import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { RequireTenantScreen } from "./guards";
import { mappedScreens, permissionsForScreen, screenGoverning } from "./screenPermissions";
import { useAuthStore } from "../../stores/authStore";
import type { User } from "../../modules/auth/types";

/**
 * THE GATE AND THE MENU ANSWER THE SAME QUESTION.
 *
 * Four surfaces decide whether to OFFER a shop screen — the sidebar, the
 * dashboard tiles, the trade panel, a notification's deep link — and all four
 * read `screenPermissions`. A fifth decided who actually gets IN, and for
 * twenty-seven routes it named the rule again by hand, in a prop that holds one
 * string.
 *
 * Which meant the four screens whose rule is ANY-of could not be expressed
 * there at all, and every one of them had drifted. The sharp one:
 *
 *     the shop's Kitchen preset grants `kitchen.manage` and nothing else —
 *     that is the whole point of it, split out of `sales.manage` on
 *     2026-08-10 so a kitchen hand need not be shown the shop's takings to
 *     mark a curry ready. The sidebar offered them Kitchen. The route guard
 *     required `sales.manage` and sent them to the dashboard.
 *
 * The one screen their job is made of, offered and refused by the same app.
 * The API was right, the map was right, the menu was right; the fifth copy was
 * wrong and nothing compared them.
 *
 * So these tests are about the JOIN, not about either half. `screenPermissions.
 * test.ts` next door pins the map's own shape.
 */

const staff = (permissions: string[]): User => ({
  id: "u1",
  name: "Sweep Staff",
  email: "staff@shopos.test",
  phone: null,
  role: "staff",
  status: "active",
  permissions,
  email_verified: true,
  phone_verified: true,
  last_login_at: null,
  created_at: "2026-08-23T00:00:00Z",
});

function signIn(permissions: string[]): void {
  useAuthStore.setState({ user: staff(permissions), isAuthenticated: true });
}

/** Renders the gate at `path` and answers whether the screen behind it drew. */
function opens(path: string): boolean {
  const { unmount } = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireTenantScreen />}>
          <Route path="*" element={<div>the screen</div>} />
        </Route>
        <Route path="/tenant" element={<div>sent home</div>} />
      </Routes>
    </MemoryRouter>,
  );
  const drew = screen.queryByText("the screen") !== null;
  unmount();

  return drew;
}

afterEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe("a job can open the screens its job is made of", () => {
  it("lets the Kitchen preset onto the kitchen board", () => {
    // `StaffPresets::kitchen` — "Sees the kitchen board and marks food ready.
    // Nothing else — not the till, not the takings." One permission, and this
    // is the only screen it is for.
    signIn(["kitchen.manage"]);

    expect(opens("/tenant/kitchen"), "the Kitchen preset was bounced off the kitchen board").toBe(true);
  });

  it("still keeps that person off the till and the takings", () => {
    // The other half of the split, and the reason it happened. Widening the
    // gate must not have handed the kitchen the shop's money.
    signIn(["kitchen.manage"]);

    for (const path of ["/tenant/pos", "/tenant/sales", "/tenant/day", "/tenant/reports"]) {
      expect(opens(path), path).toBe(false);
    }
  });

  it("lets a stockroom hand at the suppliers and purchases screens", () => {
    // READS_SUPPLIERS / READS_PURCHASE_ORDERS on the server: raising an order
    // is buying, checking the goods off the bay is stockroom work.
    signIn(["inventory.manage"]);

    expect(opens("/tenant/suppliers")).toBe(true);
    expect(opens("/tenant/purchases")).toBe(true);
  });

  it("lets a manager read the shop's own history", () => {
    // READS_AUDIT is settings.manage OR reports.view — a trail only the people
    // it is mostly ABOUT can open is not a trail.
    signIn(["reports.view"]);

    expect(opens("/tenant/activity")).toBe(true);
  });
});

describe("every rule in the map is the rule at the door", () => {
  it("admits somebody holding any one of a screen's permissions", () => {
    // The general form of the bug above. A screen listing three permissions
    // means any of the three, and a gate that honours only the first is exactly
    // as broken as the kitchen one — just not noticed yet.
    for (const path of mappedScreens()) {
      for (const permission of permissionsForScreen(path)) {
        signIn([permission]);
        expect(opens(path), `${path} refused ${permission}, which the menu offers it to`).toBe(true);
      }
    }
  });

  it("turns away somebody holding none of them", () => {
    signIn([]);

    for (const path of mappedScreens()) {
      expect(opens(path), `${path} let in a person holding nothing`).toBe(false);
    }
  });

  it("opens everything for the owner, who holds no permission list at all", () => {
    useAuthStore.setState({ user: { ...staff([]), role: "shop_owner" }, isAuthenticated: true });

    for (const path of mappedScreens()) {
      expect(opens(path), path).toBe(true);
    }
  });
});

describe("a url with an id in it is governed by its screen", () => {
  it("gives a document's detail the documents rule", () => {
    signIn(["sales.manage"]);
    expect(opens("/tenant/documents/0f8c-not-a-real-id")).toBe(true);

    signIn(["expenses.manage"]);
    expect(opens("/tenant/documents/0f8c-not-a-real-id")).toBe(false);
  });

  it("prefers the deeper rule where there is one", () => {
    // /tenant/fuel is a stock correction; /tenant/fuel/setup is configuration.
    // Longest match, or the plant would open to whoever ends shifts.
    expect(screenGoverning("/tenant/fuel/setup")).toBe("/tenant/fuel/setup");
    expect(screenGoverning("/tenant/fuel/shifts/abc")).toBe("/tenant/fuel");
  });

  it("does not treat a longer NAME as a child screen", () => {
    // Compared as strings, "/tenant/salesmen" is a child of "/tenant/sales" and
    // silently inherits its rule. Segments, not characters.
    expect(screenGoverning("/tenant/salesmen")).toBe(null);
  });

  it("leaves a screen nobody mapped open, and says which", () => {
    signIn([]);

    expect(screenGoverning("/tenant/subscription")).toBe(null);
    expect(opens("/tenant/subscription")).toBe(true);
  });
});

describe("the rule is written down exactly once", () => {
  const APP = import.meta.glob("../../App.tsx", { query: "?raw", import: "default", eager: true });

  it("leaves App.tsx naming no permission of its own", () => {
    // The regression that produced all four drifts: a second author writing the
    // rule beside the routes rather than in the map. A guard that takes a
    // permission prop is that shape returning, whatever it is called.
    const source = Object.values(APP).join("\n") as string;

    expect(source, "App.tsx names a permission again — put it in screenPermissions")
      .not.toMatch(/permission=\{?["']/);
  });
});
