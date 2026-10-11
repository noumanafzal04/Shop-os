import { describe, expect, it } from "vitest";
import type { TransferItem } from "./services/transferService";
import { askedSays, countedPayload, countProblem, lineName, qty, shortLines, shortOf, shortSays, statusSays, unitsSent, whatCanBeDone } from "./transferWords";

const line = (over: Partial<TransferItem>): TransferItem => ({
  id: "l1", product_id: "p1", variant_id: null, product_name: "Basmati 5kg", variant_name: null,
  quantity: 30, quantity_requested: null, quantity_received: null, short_reason: null, short_outcome: null, lots: null, ...over,
});

describe("what a transfer says about itself", () => {
  it("on its way is not finished, and says where the stock is", () => {
    expect(statusSays("in_transit").label).toBe("On its way");
    expect(statusSays("in_transit").hint).toContain("nobody's shelf");
  });

  it("asked for is not on its way: nothing has moved", () => {
    expect(statusSays("requested").label).toBe("Asked for");
    expect(statusSays("requested").hint).toContain("Nothing has moved");
  });

  it("a short receipt is a warning, not a completion", () => {
    expect(statusSays("short")).toMatchObject({ label: "Received short", color: "warning" });
    expect(statusSays("completed")).toMatchObject({ label: "Received", color: "success" });
    expect(statusSays("cancelled").label).toBe("Called back");
  });

  it("names a sized line by its size", () => {
    expect(lineName(line({ product_name: "Polo shirt", variant_name: "Medium" }))).toBe("Polo shirt — Medium");
    expect(lineName(line({}))).toBe("Basmati 5kg");
  });

  it("prints 2, not 2.000 — and keeps a real fraction", () => {
    expect(qty("2.000")).toBe("2");
    expect(qty(2.5)).toBe("2.5");
    expect(qty(null)).toBe("0");
  });

  it("adds up what a driver would count off the van", () => {
    expect(unitsSent({ items: [line({ quantity: "30.000" }), line({ id: "l2", quantity: 12 })] })).toBe(42);
  });
});

describe("what somebody can do with a new transfer", () => {
  const GODOWN = "godown";
  const SHOP = "shop";

  it("the owner sends or moves, and has no need to ask", () => {
    expect(whatCanBeDone(GODOWN, SHOP, { anywhere: true, ownPlace: null })).toEqual({ send: true, ask: false, move: true });
  });

  it("a keeper sends what is at their own place", () => {
    expect(whatCanBeDone(GODOWN, SHOP, { anywhere: false, ownPlace: GODOWN })).toEqual({ send: true, ask: false, move: false });
  });

  it("a keeper ASKS for what is somewhere else and wanted at theirs — they may not take it", () => {
    expect(whatCanBeDone(GODOWN, SHOP, { anywhere: false, ownPlace: SHOP })).toEqual({ send: false, ask: true, move: false });
  });

  it("a keeper at neither end can do nothing between them", () => {
    expect(whatCanBeDone(GODOWN, SHOP, { anywhere: false, ownPlace: "elsewhere" })).toEqual({ send: false, ask: false, move: false });
  });

  it("nothing is offered until both ends are chosen and differ", () => {
    expect(whatCanBeDone("", SHOP, { anywhere: true, ownPlace: null }).send).toBe(false);
    expect(whatCanBeDone(SHOP, SHOP, { anywhere: true, ownPlace: null }).move).toBe(false);
  });
});

describe("a request answered with less than it asked", () => {
  it("says both numbers once it has been sent", () => {
    expect(askedSays({ quantity: 25, quantity_requested: 40 }, true)).toBe("25 of the 40 asked for");
  });

  it("says nothing when it was answered in full, not yet sent, or never a request", () => {
    expect(askedSays({ quantity: 40, quantity_requested: "40.000" }, true)).toBeNull();
    expect(askedSays({ quantity: 40, quantity_requested: 40 }, false)).toBeNull();
    expect(askedSays({ quantity: 40, quantity_requested: null }, true)).toBeNull();
  });
});

describe("how much did not arrive", () => {
  it("is nothing until the line has been counted in", () => {
    expect(shortOf(line({ quantity: 30, quantity_received: null }))).toBe(0);
  });

  it("is what left less what came", () => {
    expect(shortOf(line({ quantity: "30.000", quantity_received: "28.000" }))).toBe(2);
    expect(shortOf(line({ quantity: 30, quantity_received: 30 }))).toBe(0);
  });

  it("lists only the lines that are short", () => {
    const short = shortLines({ items: [line({ quantity_received: 30 }), line({ id: "l2", quantity: 12, quantity_received: 9 })] });

    expect(short.map((l) => [l.item.id, l.short])).toEqual([["l2", 3]]);
  });
});

describe("what a row says about a shortage", () => {
  it("says nothing when everything arrived", () => {
    expect(shortSays({ items: [line({ quantity_received: 30 })] })).toBeNull();
  });

  it("is open while nobody has decided", () => {
    expect(shortSays({ items: [line({ quantity_received: 28, short_reason: "damaged" })] })).toEqual({ text: "2 did not arrive", open: true });
  });

  it("says what was decided once it has been, and is no longer a warning", () => {
    expect(shortSays({ items: [line({ quantity_received: 28, short_outcome: "returned" })] })).toEqual({ text: "2 short — put back", open: false });
    expect(shortSays({ items: [line({ quantity_received: 25, short_outcome: "written_off" })] })).toEqual({ text: "5 short — written off", open: false });
  });

  it("two lines with two fates are settled, without pretending to one", () => {
    const mixed = shortSays({ items: [
      line({ quantity_received: 28, short_outcome: "returned" }),
      line({ id: "l2", quantity: 12, quantity_received: 9, short_outcome: "written_off" }),
    ] });

    expect(mixed).toEqual({ text: "5 short — settled", open: false });
  });

  it("one undecided line keeps the whole row open", () => {
    const part = shortSays({ items: [
      line({ quantity_received: 28, short_outcome: "returned" }),
      line({ id: "l2", quantity: 12, quantity_received: 9 }),
    ] });

    expect(part?.open).toBe(true);
  });
});

describe("counting a transfer in", () => {
  const items = [line({}), line({ id: "l2", product_name: "Polo shirt", variant_name: "Medium", quantity: 12 })];

  it("sends nothing for lines that arrived whole — that is what receiving means", () => {
    const counted = { l1: { received: "30", reason: "" as const }, l2: { received: "12", reason: "" as const } };

    expect(countProblem(items, counted)).toBeNull();
    expect(countedPayload(items, counted)).toEqual({});
  });

  it("sends the short line with its reason, and only that line", () => {
    const counted = { l1: { received: "28", reason: "damaged" as const }, l2: { received: "12", reason: "" as const } };

    expect(countProblem(items, counted)).toBeNull();
    expect(countedPayload(items, counted)).toEqual({ items: [{ id: "l1", quantity_received: 28, short_reason: "damaged" }] });
  });

  it("will not send a short line with no reason, and names the line", () => {
    expect(countProblem(items, { l1: { received: "28", reason: "" } })).toBe("Basmati 5kg: say why 2 did not arrive.");
  });

  it("will not let more arrive than was sent", () => {
    expect(countProblem(items, { l2: { received: "13", reason: "" } })).toBe("Polo shirt — Medium: 12 was sent, so no more than 12 can arrive.");
  });

  it("an empty box is not nought — it is a line nobody counted", () => {
    expect(countProblem(items, { l1: { received: " ", reason: "" } })).toBe("Basmati 5kg: type how many arrived.");
  });

  it("nought arrived is a count, and needs a reason like any other shortage", () => {
    expect(countProblem(items, { l1: { received: "0", reason: "" } })).toBe("Basmati 5kg: say why 30 did not arrive.");
    expect(countedPayload(items, { l1: { received: "0", reason: "missing" } })).toEqual({
      items: [{ id: "l1", quantity_received: 0, short_reason: "missing" }],
    });
  });
});
