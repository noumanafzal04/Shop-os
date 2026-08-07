import { capabilitiesFor } from "../src/common/tenant/capabilities";
import type { Tenant, User, UserRole } from "../src/modules/auth/types";

/**
 * The app's shape, tested.
 *
 * Every screen in the Business App is drawn or withheld by this one hook, so a
 * mistake here is not a cosmetic bug — it either strands a paying tenant
 * outside a module they were granted, or shows a cashier a screen the server
 * will refuse. Both have happened before on the web side.
 *
 * The invariant these tests defend: A TYPE PROPOSES MODULES, THE ADMIN ASSIGNS
 * THEM. Nothing may be decided from the trade alone.
 */

const tenant = (over: Partial<Tenant> = {}): Tenant => ({
  id: "t1",
  business_name: "Test Shop",
  slug: "test-shop",
  email: null,
  phone: null,
  business_type: "mart",
  business_type_primary: "mart",
  business_category: null,
  features: {},
  item_types: [],
  limits: {},
  online_shop_enabled: false,
  status: "active",
  setup_completed: true,
  subscription_ends_at: null,
  subscription_expired: false,
  logo_path: null,
  address: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

let current: User | null = null;

const signIn = (role: UserRole, permissions: string[], t: Tenant | null) => {
  const user: User = {
    id: "u1",
    name: "Test",
    email: null,
    phone: null,
    role,
    status: "active",
    permissions,
    branch_id: null,
    email_verified: true,
    phone_verified: false,
    last_login_at: null,
    tenant: t,
    created_at: "2026-01-01T00:00:00Z",
  };
  current = user;
};

const caps = () => capabilitiesFor(current);

afterEach(() => { current = null; });

describe("modules", () => {
  it("grants only what the tenant was actually assigned", () => {
    signIn("shop_owner", [], tenant({ features: { pos: true, expenses: true } }));
    const c = caps();

    expect(c.hasModule("pos")).toBe(true);
    expect(c.hasModule("dine_in")).toBe(false);
  });

  /**
   * The invariant. A mart's TYPE proposes dine-in nowhere, but what matters is
   * the grant — if an admin turned a module on for this shop, the app must
   * show it, and if they did not, it must not.
   */
  it("reads the grant, never the trade", () => {
    signIn("shop_owner", [], tenant({ business_type_primary: "mart", features: { dine_in: true } }));

    expect(caps().restaurant).toBe(true);
  });

  it("treats a missing key as off, not as absent", () => {
    signIn("shop_owner", [], tenant({ features: { pos: false } }));

    expect(caps().hasModule("pos")).toBe(false);
    expect(caps().hasModule("never_heard_of_it")).toBe(false);
  });

  it("matches the backend's any-of gate", () => {
    signIn("shop_owner", [], tenant({ features: { delivery: true } }));

    expect(caps().hasAnyModule("marketplace", "delivery")).toBe(true);
    expect(caps().hasAnyModule("pos", "dine_in")).toBe(false);
  });
});

describe("permissions", () => {
  it("gives a shop owner everything, like the backend does", () => {
    signIn("shop_owner", [], tenant());

    expect(caps().can("sales.manage")).toBe(true);
    expect(caps().can("anything.at.all")).toBe(true);
  });

  it("gives staff only what they hold", () => {
    signIn("staff", ["sales.manage"], tenant());
    const c = caps();

    expect(c.can("sales.manage")).toBe(true);
    expect(c.can("settings.manage")).toBe(false);
  });
});

describe("trade", () => {
  it("prefers the resolved trade over the raw code", () => {
    signIn("shop_owner", [], tenant({ business_type: "grocery", business_type_primary: "mart" }));

    expect(caps().trade).toBe("mart");
    expect(caps().isTrade("mart")).toBe(true);
    expect(caps().isTrade("grocery")).toBe(false);
  });

  /** A session persisted before the field existed must not lose its screens. */
  it("falls back to the raw code when the resolved one is missing", () => {
    signIn("shop_owner", [], tenant({ business_type: "pharmacy", business_type_primary: null }));

    expect(caps().trade).toBe("pharmacy");
  });
});

describe("the shape of the app", () => {
  it("a books-only tenant becomes a finance app", () => {
    signIn("shop_owner", [], tenant({ features: { expenses: true } }));
    const c = caps();

    expect(c.booksOnly).toBe(true);
    expect(c.sells).toBe(false);
    expect(c.pos).toBe(false);
  });

  it("a shop that sells is not books-only, even with expenses on", () => {
    signIn("shop_owner", [], tenant({ features: { expenses: true, pos: true, products: true } }));
    const c = caps();

    expect(c.booksOnly).toBe(false);
    expect(c.sells).toBe(true);
  });

  it("a restaurant gets its floor", () => {
    signIn("shop_owner", [], tenant({
      business_type_primary: "food",
      features: { pos: true, products: true, dine_in: true, expenses: true },
    }));
    const c = caps();

    expect(c.restaurant).toBe(true);
    expect(c.pos).toBe(true);
  });

  it("signed out, nothing is granted and nothing throws", () => {
    const c = caps();

    expect(c.trade).toBeNull();
    expect(c.hasModule("pos")).toBe(false);
    expect(c.can("sales.manage")).toBe(false);
    expect(c.booksOnly).toBe(false);
  });
});

describe("showScreen — the one gate", () => {
  const shop = () =>
    signIn("staff", ["sales.manage"], tenant({
      business_type_primary: "pharmacy",
      features: { pos: true, products: true },
    }));

  it("shows a screen whose module and permission are both held", () => {
    shop();
    expect(caps().showScreen({ modules: ["pos"], permissions: ["sales.manage"] })).toBe(true);
  });

  it("withholds a screen whose module is off", () => {
    shop();
    expect(caps().showScreen({ modules: ["dine_in"] })).toBe(false);
  });

  it("withholds a screen the person cannot use", () => {
    shop();
    expect(caps().showScreen({ modules: ["pos"], permissions: ["settings.manage"] })).toBe(false);
  });

  it("requires ALL listed permissions, but ANY listed module", () => {
    shop();
    expect(caps().showScreen({ permissions: ["sales.manage", "settings.manage"] })).toBe(false);
    expect(caps().showScreen({ modules: ["dine_in", "pos"] })).toBe(true);
  });

  it("fences a trade screen to its trade", () => {
    shop();
    expect(caps().showScreen({ trades: ["pharmacy"] })).toBe(true);
    expect(caps().showScreen({ trades: ["automotive"] })).toBe(false);
  });

  it("an empty spec is always shown", () => {
    shop();
    expect(caps().showScreen({})).toBe(true);
  });
});
