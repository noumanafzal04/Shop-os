import { describe, expect, it } from "vitest";

import type { NavItem } from "./navItem";
import { saysOf, withOrdersWaiting } from "./ordersWaiting";

const rail = (): NavItem[] => [
  { icon: null, name: "Dashboard", path: "/tenant" },
  { icon: null, name: "Orders", path: "/tenant/orders" },
  { icon: null, name: "Riders", path: "/tenant/riders" },
];
const orders = (items: NavItem[]) => items.find((i) => i.path === "/tenant/orders")!;

describe("the count beside Orders on the rail", () => {
  it("counts what is being worked, and blinks for one nobody has accepted", () => {
    const row = orders(withOrdersWaiting(rail(), { new: 1, being_worked: 4 }));

    expect(row.badge).toBe(4);
    expect(row.alert).toBe(true);
    expect(row.badgeSays).toBe("4 orders being worked, 1 new");
  });

  it("is steady when everything on the board has been accepted — cooking is not an alarm", () => {
    const row = orders(withOrdersWaiting(rail(), { new: 0, being_worked: 3 }));

    expect(row.badge).toBe(3);
    expect(row.alert).toBe(false);
    expect(row.badgeSays).toBe("3 orders being worked");
  });

  it("draws nothing when nothing is waiting, and nothing before the answer has arrived", () => {
    expect(orders(withOrdersWaiting(rail(), { new: 0, being_worked: 0 })).badge).toBeUndefined();
    expect(orders(withOrdersWaiting(rail(), undefined)).badge).toBeUndefined();
  });

  it("marks that row and no other", () => {
    const marked = withOrdersWaiting(rail(), { new: 2, being_worked: 2 }).filter((i) => i.badge !== undefined);

    expect(marked.map((i) => i.name)).toEqual(["Orders"]);
  });

  it("leaves a rail that has no Orders row as it found it", () => {
    const short = rail().filter((i) => i.path !== "/tenant/orders");

    expect(withOrdersWaiting(short, { new: 5, being_worked: 5 })).toEqual(short);
  });

  it("says one order as one order", () => {
    expect(saysOf({ new: 1, being_worked: 1 })).toBe("1 order being worked, 1 new");
  });
});
