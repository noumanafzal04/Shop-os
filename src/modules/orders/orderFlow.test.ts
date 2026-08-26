import { describe, expect, it } from "vitest";

import { nextStep } from "./orderFlow";
import type { OrderStatus, OwnerOrder } from "./services/ordersService";

const order = (status: OrderStatus, fulfillment: "delivery" | "pickup" = "delivery") =>
  ({ status, fulfillment_type: fulfillment }) as OwnerOrder;

describe("the next step", () => {
  it("forks on fulfilment where the two flows diverge", () => {
    // Getting this the wrong way round tells a customer their food is on a
    // bike that does not exist.
    expect(nextStep(order("preparing", "delivery"))?.status).toBe("out_for_delivery");
    expect(nextStep(order("preparing", "pickup"))?.status).toBe("ready");
  });

  it("walks a delivery from placed to completed with no dead end", () => {
    let current = order("pending");
    const walked: string[] = ["pending"];

    for (let guard = 0; guard < 10; guard++) {
      const step = nextStep(current);
      if (step === null) break;
      walked.push(step.status);
      current = order(step.status);
    }

    expect(walked).toEqual(["pending", "confirmed", "preparing", "out_for_delivery", "completed"]);
  });

  it("walks a pickup the same way through its own middle", () => {
    let current = order("pending", "pickup");
    const walked: string[] = ["pending"];

    for (let guard = 0; guard < 10; guard++) {
      const step = nextStep(current);
      if (step === null) break;
      walked.push(step.status);
      current = order(step.status, "pickup");
    }

    expect(walked).toEqual(["pending", "confirmed", "preparing", "ready", "completed"]);
  });

  it("offers nothing once an order is finished either way", () => {
    // Not a disabled button — no button. A control that can never be pressed
    // is a control somebody keeps trying to press.
    expect(nextStep(order("completed"))).toBeNull();
    expect(nextStep(order("cancelled"))).toBeNull();
  });

  it("names every step, so no button can render blank", () => {
    for (const stage of ["pending", "confirmed", "preparing", "ready", "out_for_delivery"] as OrderStatus[]) {
      expect(nextStep(order(stage))?.label, stage).toBeTruthy();
    }
  });
});
