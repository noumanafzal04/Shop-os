import { beforeEach, describe, expect, it, vi } from "vitest";

import { heldFor } from "./kept";
import { useKeptStore } from "./keptStore";

/**
 * The record the shell keeps between loads. One, and somebody's.
 */

const store = () => useKeptStore.getState();

beforeEach(() => {
  useKeptStore.setState({ record: null });
});

describe("keeping", () => {
  it("keeps an answer with the moment it was heard", () => {
    store().keep("t1:u1", "settings", { tax: 5 }, 1000);

    expect(heldFor(store().record, "t1:u1", "settings")).toEqual({ data: { tax: 5 }, at: 1000, under: null });
  });

  it("keeps a second answer beside the first", () => {
    store().keep("t1:u1", "settings", { tax: 5 }, 1000);
    store().keep("t1:u1", "branches", ["Main"], 2000);

    expect(heldFor(store().record, "t1:u1", "settings")?.data).toEqual({ tax: 5 });
    expect(heldFor(store().record, "t1:u1", "branches")?.data).toEqual(["Main"]);
  });

  it("replaces an answer with the newer one of the same name", () => {
    store().keep("t1:u1", "settings", { tax: 5 }, 1000);
    store().keep("t1:u1", "settings", { tax: 17 }, 3000);

    expect(heldFor(store().record, "t1:u1", "settings")).toEqual({ data: { tax: 17 }, at: 3000, under: null });
  });

  it("is written to the device, under the panel's own prefix", () => {
    store().keep("t1:u1", "settings", { tax: 5 }, 1000);

    const written = JSON.parse(localStorage.getItem("shopos-kept") ?? "{}") as { state?: { record?: unknown } };
    expect(written.state?.record).toEqual({ owner: "t1:u1", stamp: null, held: { settings: { data: { tax: 5 }, at: 1000, under: null } } });
  });
});

describe("one record, and somebody's", () => {
  it("starts a new record for the next shop — nothing of the last one comes along", () => {
    store().keep("t1:u1", "settings", { tax: 5 }, 1000);
    store().keep("t1:u1", "branches", ["Main"], 1000);

    store().keep("t2:u1", "settings", { tax: 0 }, 2000);

    expect(store().record).toEqual({ owner: "t2:u1", stamp: null, held: { settings: { data: { tax: 0 }, at: 2000, under: null } } });
    expect(heldFor(store().record, "t2:u1", "branches"), "the last shop's branches were carried into this one").toBeNull();
  });

  it("starts a new record for the next person at the same counter", () => {
    store().keep("t1:u1", "notifications", ["yours"], 1000);

    store().keep("t1:u2", "settings", { tax: 5 }, 2000);

    expect(heldFor(store().record, "t1:u2", "notifications"), "one person's bell was kept for the next").toBeNull();
    expect(heldFor(store().record, "t1:u1", "notifications")).toBeNull();
  });

  it("forgets everything when somebody signs out", () => {
    store().keep("t1:u1", "settings", { tax: 5 }, 1000);

    store().forget();

    expect(store().record).toBeNull();
    expect(JSON.parse(localStorage.getItem("shopos-kept") ?? "{}").state.record).toBeNull();
  });
});

describe("a browser that will not store", () => {
  /**
   * Zustand writes to storage inside `setState` and lets the browser's error
   * out through it. `keep` is called from inside the asking itself, so a full
   * disk would have turned "the settings arrived" into a query that FAILED.
   */
  it("keeps nothing, and says nothing — the answer it was given is not lost with it", () => {
    const refuses = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => store().keep("t1:u1", "settings", { tax: 5 }, 1000)).not.toThrow();
    expect(() => store().forget()).not.toThrow();

    refuses.mockRestore();
  });

  it("still holds the answer for the rest of this visit", () => {
    const refuses = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    store().keep("t1:u1", "settings", { tax: 5 }, 1000);

    expect(heldFor(store().record, "t1:u1", "settings")?.data).toEqual({ tax: 5 });
    refuses.mockRestore();
  });
});

describe("the server's stamp", () => {
  it("is kept the first time, and that is not a change", () => {
    expect(store().hear("t1:u1", "aaaa")).toBe("first");
    expect(store().record?.stamp).toBe("aaaa");
  });

  it("is not a change, and is not written again, while it stays the same", () => {
    store().hear("t1:u1", "aaaa");
    const written = vi.spyOn(Storage.prototype, "setItem");

    expect(store().hear("t1:u1", "aaaa")).toBe("same");

    expect(written).not.toHaveBeenCalled();
    written.mockRestore();
  });

  it("is a change when it differs from one already heard", () => {
    store().hear("t1:u1", "aaaa");

    expect(store().hear("t1:u1", "bbbb")).toBe("moved");
    expect(store().record?.stamp).toBe("bbbb");
  });

  it("keeps the answers that were already there", () => {
    store().keep("t1:u1", "settings", { tax: 5 }, 1000);

    store().hear("t1:u1", "aaaa");

    expect(heldFor(store().record, "t1:u1", "settings")?.data).toEqual({ tax: 5 });
  });

  it("is the stamp an answer is kept under", () => {
    store().hear("t1:u1", "aaaa");
    store().keep("t1:u1", "settings", { tax: 5 }, 1000);
    store().hear("t1:u1", "bbbb");
    store().keep("t1:u1", "branches", ["Main"], 2000);

    expect(heldFor(store().record, "t1:u1", "settings")?.under).toBe("aaaa");
    expect(heldFor(store().record, "t1:u1", "branches")?.under).toBe("bbbb");
    expect(store().record?.stamp).toBe("bbbb");
  });

  it("is not a change for the next person — theirs is simply another stamp", () => {
    store().hear("t1:u1", "aaaa");
    store().keep("t1:u1", "settings", { tax: 5 }, 1000);

    expect(store().hear("t1:u2", "cccc")).toBe("first");

    expect(store().record).toEqual({ owner: "t1:u2", held: {}, stamp: "cccc" });
  });
});
