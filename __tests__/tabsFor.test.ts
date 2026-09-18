import { fs, path, PROJECT_ROOT } from "./support/node";
import { tabsFor, landingTab } from "../src/navigation/tabsFor";
import type { SessionUser } from "../src/types/session";

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: "u1",
  name: "Owner",
  email: "owner@shop.pk",
  phone: null,
  role: "shop_owner",
  status: "active",
  branch_id: null,
  permissions: [],
  tenant: {
    id: "t1",
    business_name: "Ali Karahi",
    business_type: "food",
    business_type_primary: "food",
    online_shop_enabled: true,
    setup_completed: true,
    status: "active",
    images_enabled: true,
    features: {},
  },
  ...over,
});

describe("which tabs a person gets", () => {
  it("gives everybody Dashboard and Account, whatever they may do", () => {
    expect(tabsFor(user())).toEqual(["Dashboard", "Account"]);
  });

  it("gives nothing at all when nobody is signed in", () => {
    expect(tabsFor(null)).toEqual([]);
    expect(landingTab(null)).toBeNull();
  });

  /**
   * ONE ASSERTION PER GATE, BOTH HALVES.
   *
   * A test that only ever grants the permission proves the tab appears; it
   * says nothing about whether the gate exists. Every case below is asserted
   * with the gate open AND shut, because this file is the only thing standing
   * between a staff member and a screen that will refuse them.
   */
  it("opens Orders on orders.manage — and only for a shop that sells online", () => {
    const withPerm = { permissions: ["orders.manage"] };
    expect(tabsFor(user(withPerm))).toContain("Orders");
    expect(tabsFor(user())).not.toContain("Orders");

    const offline = user({
      ...withPerm,
      tenant: { ...user().tenant!, online_shop_enabled: false },
    });
    expect(tabsFor(offline)).not.toContain("Orders");
  });

  it("opens Menu on products.manage AND the products module", () => {
    const perm = { permissions: ["products.manage"] };
    // Permission without the module is not enough.
    expect(tabsFor(user(perm))).not.toContain("Menu");

    const both = user({
      ...perm,
      tenant: { ...user().tenant!, features: { products: true } },
    });
    expect(tabsFor(both)).toContain("Menu");

    // The module without the permission is not enough either.
    const moduleOnly = user({ tenant: { ...user().tenant!, features: { products: true } } });
    expect(tabsFor(moduleOnly)).not.toContain("Menu");
  });

  it("opens Money on reports.view", () => {
    expect(tabsFor(user({ permissions: ["reports.view"] }))).toContain("Money");
    expect(tabsFor(user())).not.toContain("Money");
  });

  it("keeps the bar in a fixed order however the permissions arrive", () => {
    const shuffled = user({
      permissions: ["reports.view", "products.manage", "orders.manage"],
      tenant: { ...user().tenant!, features: { products: true } },
    });
    expect(tabsFor(shuffled)).toEqual(["Dashboard", "Orders", "Menu", "Money", "Account"]);
  });

  it("lands on the first tab the person actually has", () => {
    expect(landingTab(user())).toBe("Dashboard");
  });

  /**
   * EVERY TAB IN THE TYPE HAS A RULE.
   *
   * `PartnerTabs` declares its table as `Record<PartnerTab, …>`, so the
   * compiler already refuses a tab with no icon and no screen. Nothing refuses
   * a tab with no RULE — it would simply never appear, for anybody, and an
   * absent tab looks like a decision rather than an omission.
   *
   * Asserted by granting everything and checking the count, which is the only
   * version of this that fails when a tab is added and forgotten.
   */
  it("has a rule for every tab the type declares", () => {
    const everything = user({
      permissions: ["orders.manage", "products.manage", "reports.view"],
      tenant: { ...user().tenant!, features: { products: true } },
    });

    const source = fs.readFileSync(
      path.join(PROJECT_ROOT, "src", "navigation", "tabsFor.ts"),
      "utf8",
    );
    const declared = source
      .match(/export type PartnerTab =([^;]+);/)![1]
      .split("|")
      .map((t: string) => t.trim().replace(/"/g, ""));

    expect(tabsFor(everything).sort()).toEqual(declared.sort());
  });
});

/**
 * THE PERMISSION NAMES ARE REAL.
 *
 * The plan for this file said Money needed `reports.read`. That permission
 * does not exist — it is `reports.view` — and written from memory it would
 * have hidden the Money tab from everybody, for ever, with no error anywhere.
 * A tab that is simply absent looks like a product decision.
 *
 * So the strings are checked against the SERVER's own list rather than against
 * a copy. If the backend is not beside this checkout the test says so instead
 * of passing quietly, because a guard that skips itself when it cannot look is
 * a guard that is always green.
 */
describe("the permissions it names exist on the server", () => {
  const permissionsFile = path.join(PROJECT_ROOT, "..", "backend", "app", "Support", "Permissions.php");

  it("finds the backend", () => {
    expect(fs.existsSync(permissionsFile)).toBe(true);
  });

  it("names only permissions the server defines", () => {
    const php = fs.readFileSync(permissionsFile, "utf8");
    const source = fs.readFileSync(
      path.join(PROJECT_ROOT, "src", "navigation", "tabsFor.ts"),
      "utf8",
    );

    // `permission: "x.y"` in the rules table — comments are not matched
    // because the key is required.
    const used = [...source.matchAll(/permission:\s*"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);

    for (const permission of used) {
      expect(php).toContain(`'${permission}'`);
    }
  });
});
