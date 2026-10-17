import { afterEach, describe, expect, it } from "vitest";

import { api } from "../../../common/api/client";
import { dineInService } from "./dineInService";

/**
 * A WAITER'S TAPS ARE EACH A DISH.
 *
 * The app-wide guard hands a write pressed twice the first press's answer.
 * On the tab that guard swallowed food: four taps on naan were four identical
 * "one more", one was sent, and three naan were served and never charged
 * (money pass 2026-10-16, $10).
 */
type Sent = { method: string; url: string; body: unknown };

const server = (sent: Sent[]) => {
  api.defaults.adapter = async (config) => {
    sent.push({ method: String(config.method), url: String(config.url), body: config.data });
    await new Promise((r) => setTimeout(r, 1));
    return { status: 200, statusText: "", headers: {}, config, data: { success: true, message: "OK", data: { id: "t1", items: [] }, meta: {} } } as never;
  };
};

afterEach(() => {
  delete api.defaults.adapter;
});

describe("taps on a tab", () => {
  it("sends every step on a line — four taps, four naan", async () => {
    const sent: Sent[] = [];
    server(sent);

    await Promise.all([1, 2].map(() => dineInService.updateItem("tab-steps", "naan", { adjust: 1 })));
    await dineInService.updateItem("tab-steps", "naan", { adjust: 1 });
    await dineInService.updateItem("tab-steps", "naan", { adjust: 1 });

    expect(sent, "a tap on the same dish was taken for the tap before it").toHaveLength(4);
  });

  it("sends every dish added, even the same dish with the same note", async () => {
    const sent: Sent[] = [];
    server(sent);
    const naan = { product_id: "naan", quantity: 1, note: "extra butter" } as never;

    await dineInService.addItems("tab-adds", [naan]);
    await dineInService.addItems("tab-adds", [naan]);

    expect(sent).toHaveLength(2);
  });

  it("still sends a note pressed twice once — it is a target, not a step", async () => {
    const sent: Sent[] = [];
    server(sent);

    await Promise.all([1, 2].map(() => dineInService.updateItem("tab-note", "naan", { note: "well done" })));

    expect(sent).toHaveLength(1);
  });
});
