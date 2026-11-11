import { describe, expect, it } from "vitest";

import {
  forgetStep, hoursFor, settingsToSave, setupExtras, setupSteps, whyNot, type SetupAnswers, type SetupStep,
} from "./setupSteps";

const none = new Set<SetupStep>();
const all = setupSteps(true, true);

describe("setting up a shop, a step at a time", () => {
  it("asks where it is and its money always; the counter and online orders only where they exist", () => {
    expect(setupSteps(true, true)).toEqual(["shop", "money", "counter", "online"]);
    expect(setupSteps(true, false)).toEqual(["shop", "money", "counter"]);
    expect(setupSteps(false, false)).toEqual(["shop", "money"]);
  });

  it("saves only what was answered — finishing at once saves nothing, exactly the old setup", () => {
    expect(settingsToSave({}, none, all)).toEqual({});
    expect(setupExtras({}, none, all, "Asia/Karachi")).toEqual({});
    expect(settingsToSave({ default_tax_rate: 17, pos_auto_print: true, pickup_enabled: false }, none, all))
      .toEqual({ default_tax_rate: 17, pos_auto_print: true, pickup_enabled: false });
  });

  it("saves nothing from a skipped step", () => {
    const answers: SetupAnswers = {
      default_tax_rate: 17, tax_inclusive: true, receipt_width: "thermal_58", pos_require_shift: true,
      delivery_fee: 150, business_hours: hoursFor([1, 2], "09:00", "21:00"), min_order_amount: 500,
    };

    expect(settingsToSave(answers, new Set<SetupStep>(["money", "online"]), all))
      .toEqual({ receipt_width: "thermal_58", pos_require_shift: true });
    expect(setupExtras(answers, new Set<SetupStep>(["online"]), all, "Asia/Karachi")).toEqual({});
    expect(setupExtras(answers, none, all, "Asia/Karachi"))
      .toEqual({ business_hours: hoursFor([1, 2], "09:00", "21:00"), delivery_fee: 150 });
  });

  it("never saves a step this business is not asked", () => {
    const books = setupSteps(false, false);
    expect(settingsToSave({ pos_auto_print: true, default_tax_rate: 5, pickup_enabled: true }, none, books)).toEqual({ default_tax_rate: 5 });
    expect(setupExtras({ delivery_fee: 100 }, none, books, undefined)).toEqual({});
  });

  it("sends the clock only when it was changed, and not from a skipped step", () => {
    expect(setupExtras({ timezone: "Asia/Dubai" }, none, all, "Asia/Karachi")).toEqual({ timezone: "Asia/Dubai" });
    expect(setupExtras({ timezone: "Asia/Karachi" }, none, all, "Asia/Karachi")).toEqual({});
    expect(setupExtras({ timezone: "Asia/Dubai" }, new Set<SetupStep>(["money"]), all, "Asia/Karachi")).toEqual({});
  });

  it("forgets what was typed on a skipped step, and only that step", () => {
    const answers: SetupAnswers = { timezone: "Asia/Dubai", default_tax_rate: 5, pos_auto_print: true, delivery_fee: 99 };

    expect(forgetStep(answers, "money")).toEqual({ pos_auto_print: true, delivery_fee: 99 });
    expect(forgetStep(answers, "counter")).toEqual({ timezone: "Asia/Dubai", default_tax_rate: 5, delivery_fee: 99 });
    expect(forgetStep(answers, "online")).toEqual({ timezone: "Asia/Dubai", default_tax_rate: 5, pos_auto_print: true });
    expect(forgetStep(answers, "shop")).toEqual(answers);
  });

  it("writes the same hours on the chosen days, Sunday as 0, in day order", () => {
    expect(hoursFor([6, 1, 0], "10:00", "22:00")).toEqual([
      { day: 0, open: "10:00", close: "22:00" },
      { day: 1, open: "10:00", close: "22:00" },
      { day: 6, open: "10:00", close: "22:00" },
    ]);
  });

  it("stops on the step the server would refuse: no way to get an order, or a day that closes before it opens", () => {
    const on = { pickup: true, delivery: true };
    expect(whyNot("online", { pickup_enabled: false, delivery_enabled: false }, on)).toMatch(/keep collecting or delivery on/);
    expect(whyNot("online", { pickup_enabled: false }, on)).toBeNull();
    expect(whyNot("online", { business_hours: hoursFor([1], "22:00", "09:00") }, on)).toMatch(/after opening time/);
    expect(whyNot("online", { business_hours: hoursFor([1], "09:00", "22:00") }, on)).toBeNull();
    expect(whyNot("money", { pickup_enabled: false, delivery_enabled: false }, on)).toBeNull();
  });
});
