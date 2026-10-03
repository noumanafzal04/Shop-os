import { fs, path, PROJECT_ROOT } from "./support/node";
import {
  holds,
  ROLES_HOLDING_EVERY_PERMISSION,
  ROLES_HOLDING_NO_PERMISSION,
} from "../src/common/permissions";
import { tabsFor } from "../src/navigation/tabsFor";
import type { SessionUser } from "../src/types/session";

const USER_PHP = path.join(PROJECT_ROOT, "..", "backend", "app", "Models", "User.php");
const ROLE_PHP = path.join(PROJECT_ROOT, "..", "backend", "app", "Enums", "UserRole.php");

const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

const ALL_FEATURES = {
  products: true,
  delivery: true,
  expenses: true,
  inventory: true,
  customers: true,
};

const person = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: "u1",
  name: "Somebody",
  email: "a@b.pk",
  phone: null,
  role: "staff",
  status: "active",
  branch_id: null,
  permissions: [],
  tenant: {
    id: "t1",
    business_name: "Karahi House",
    business_type: null,
    business_type_primary: null,
    online_shop_enabled: true,
    setup_completed: true,
    status: "active",
    images_enabled: true,
    features: ALL_FEATURES,
  },
  ...over,
});

describe("this app answers 'may you' the way the server answers it", () => {
  const user = read(USER_PHP);
  const roles = read(ROLE_PHP);

  it("can see the server, or every case below is vacuous", () => {
    expect(user).not.toBe("");
    expect(roles).not.toBe("");
  });

  /**
   * READ OUT OF THE PHP, not remembered.
   *
   * This file exists because the app remembered the wrong rule once already:
   * it asked `permissions.includes(p)` while the server's `hasPermission()`
   * grants owners everything by role. Writing the role names here from memory
   * would be the same mistake wearing a test's clothes.
   */
  it("grants exactly the roles the server's hasPermission() grants", () => {
    const body = user.slice(user.indexOf("function hasPermission"));
    const arm = body.slice(body.indexOf("match ("), body.indexOf("};"));

    // "UserRole::SuperAdmin, UserRole::ShopOwner => true"
    const everything = (arm.match(/([\w:,\s]+)=>\s*true/) ?? [, ""])[1];
    const caseNames = [...everything.matchAll(/UserRole::(\w+)/g)].map((m) => m[1]);
    expect(caseNames.length).toBeGreaterThan(0);

    // Each PHP case name -> its string value, from the enum.
    const value = (name: string) =>
      (roles.match(new RegExp(`case\\s+${name}\\s*=\\s*'([a-z_]+)'`)) ?? [, ""])[1];

    expect([...ROLES_HOLDING_EVERY_PERMISSION].sort()).toEqual(caseNames.map(value).sort());
  });

  it("denies exactly the roles the server denies outright", () => {
    const body = user.slice(user.indexOf("function hasPermission"));
    const arm = body.slice(body.indexOf("match ("), body.indexOf("};"));
    const none = (arm.match(/([\w:,\s]+)=>\s*false/) ?? [, ""])[1];
    const caseNames = [...none.matchAll(/UserRole::(\w+)/g)].map((m) => m[1]);
    const value = (name: string) =>
      (roles.match(new RegExp(`case\\s+${name}\\s*=\\s*'([a-z_]+)'`)) ?? [, ""])[1];

    expect([...ROLES_HOLDING_NO_PERMISSION].sort()).toEqual(caseNames.map(value).sort());
  });

  it("gives an owner with an EMPTY permission list the whole app", () => {
    /**
     * THE CASE NOBODY WROTE, AND THE ONLY ONE THAT MATTERS MOST.
     *
     * Every fixture in `tabsFor.test.ts` hands over a permissions ARRAY. A
     * real shop owner arrives with `permissions: []` and `role: shop_owner`,
     * because the server grants by role — and signing in as one gave a
     * two-tab app with no error anywhere.
     */
    const owner = person({ role: "shop_owner", permissions: [] });

    expect(holds(owner, "orders.manage")).toBe(true);
    expect(holds(owner, "products.manage")).toBe(true);
    expect(holds(owner, "reports.view")).toBe(true);
    expect(tabsFor(owner)).toEqual(["Dashboard", "Orders", "Menu", "Money", "Account"]);
  });

  it("still gives a staff member only what they were assigned", () => {
    // The fix must not become "everybody sees everything", which is the other
    // way to make a permission list meaningless.
    const cashier = person({ role: "staff", permissions: ["orders.manage"] });

    expect(holds(cashier, "orders.manage")).toBe(true);
    expect(holds(cashier, "reports.view")).toBe(false);
    expect(tabsFor(cashier)).toEqual(["Dashboard", "Orders", "Account"]);
  });

  it("gives a customer nothing, whatever their permission list says", () => {
    // A shopper signed into the wrong app. The server refuses by role before
    // it ever looks at the array, and so does this.
    const shopper = person({ role: "customer", permissions: ["orders.manage"] });

    expect(holds(shopper, "orders.manage")).toBe(false);
    expect(tabsFor(shopper)).toEqual(["Dashboard", "Account"]);
  });
});
