import { fs, path, PROJECT_ROOT, codeOnly, sourceFiles } from "./support/node";
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
  it("opens Orders on orders.manage AND the products module", () => {
    const perm = { permissions: ["orders.manage"] };
    // Permission alone is not enough — the route is gated on the module too.
    expect(tabsFor(user(perm))).not.toContain("Orders");

    const both = user({
      ...perm,
      tenant: { ...user().tenant!, features: { products: true } },
    });
    expect(tabsFor(both)).toContain("Orders");
  });

  /**
   * THE GATE THIS TAB DOES **NOT** HAVE.
   *
   * A pharmacy that takes orders by phone and delivers them sells nothing
   * online: `online_shop_enabled` is false and `marketplace` is off. It still
   * has orders, and `POST /orders` exists for exactly that shop.
   *
   * The first version of this rule asked `online_shop_enabled` and would have
   * hidden the tab from it — the same mistake the server had already made and
   * fixed, with the reason written on the route. Asserted so it cannot come
   * back.
   */
  it("still shows Orders to a shop that sells nothing online", () => {
    const phoneOnly = user({
      permissions: ["orders.manage"],
      tenant: {
        ...user().tenant!,
        online_shop_enabled: false,
        features: { products: true },
      },
    });
    expect(tabsFor(phoneOnly)).toContain("Orders");
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

  it("names only permissions the server defines — ANYWHERE in the app", () => {
    /**
     * Widened from `tabsFor.ts` to the whole of `src`, because a permission
     * name can be invented anywhere. The Account screen gates a Shop settings
     * row on `settings.manage`; a typo there hides the row for ever with no
     * error, exactly as `reports.read` would have hidden the Money tab.
     *
     * Two spellings are collected: `permission: "x.y"` in a rules table, and
     * `can("x.y")` at a call site. Comments are stripped first — a guard that
     * greps for the thing it forbids finds its own explanation of it.
     */
    const php = fs.readFileSync(permissionsFile, "utf8");

    const used = new Set<string>();
    for (const file of sourceFiles(path.join(PROJECT_ROOT, "src"))) {
      const code = codeOnly(fs.readFileSync(file, "utf8"));
      for (const m of code.matchAll(/permission:\s*"([a-z_]+\.[a-z_]+)"/g)) used.add(m[1]!);
      for (const m of code.matchAll(/\bcan\(\s*"([a-z_]+\.[a-z_]+)"\s*\)/g)) used.add(m[1]!);
    }

    // Zero found means the patterns stopped matching, not that the app has
    // stopped using permissions.
    expect(used.size).toBeGreaterThan(2);

    for (const permission of used) {
      expect({ permission, onServer: php.includes(`'${permission}'`) }).toEqual({
        permission,
        onServer: true,
      });
    }
  });
});
