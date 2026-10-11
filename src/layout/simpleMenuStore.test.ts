import { beforeEach, describe, expect, it } from "vitest";

import { NO_CHOICE } from "./simpleMenu";
import { readChoice, writeChoice } from "./simpleMenuStore";

/**
 * WHERE A PERSON'S SIMPLE MENU IS KEPT.
 *
 * On the device, under the person's own id: a till is shared and a menu is
 * not. What is held here is that two people on one tablet never read each
 * other's, and that a device holding nonsense gives the usual menu rather
 * than a blank rail.
 */
describe("a Simple menu is kept per person, on the device", () => {
  beforeEach(() => localStorage.clear());

  it("comes back as it was left", () => {
    writeChoice("owner-1", { add: ["/tenant/reports"], drop: ["/tenant/sales"] });

    expect(readChoice("owner-1")).toEqual({ add: ["/tenant/reports"], drop: ["/tenant/sales"] });
  });

  it("is the person's, not the tablet's", () => {
    writeChoice("owner-1", { add: ["/tenant/reports"], drop: [] });

    expect(readChoice("cashier-2")).toEqual(NO_CHOICE);
    expect(localStorage.getItem("shopos-simple-menu:owner-1")).not.toBeNull();
  });

  it("the usual menu is kept as nothing at all", () => {
    writeChoice("owner-1", { add: ["/tenant/reports"], drop: [] });
    writeChoice("owner-1", NO_CHOICE);

    expect(localStorage.getItem("shopos-simple-menu:owner-1")).toBeNull();
  });

  it("nonsense on the device is the usual menu, not a broken one", () => {
    localStorage.setItem("shopos-simple-menu:owner-1", "{not json");
    expect(readChoice("owner-1")).toEqual(NO_CHOICE);

    localStorage.setItem("shopos-simple-menu:owner-1", JSON.stringify({ add: [3, "/tenant/reports"], drop: "all" }));
    expect(readChoice("owner-1")).toEqual({ add: ["/tenant/reports"], drop: [] });
  });

  it("nobody signed in has nothing kept and keeps nothing", () => {
    writeChoice(undefined, { add: ["/tenant/reports"], drop: [] });

    expect(localStorage.length).toBe(0);
    expect(readChoice(undefined)).toEqual(NO_CHOICE);
  });
});
