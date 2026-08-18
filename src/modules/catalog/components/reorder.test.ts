import { describe, expect, it } from "vitest";
import { insertionFor, moveTo, sameOrder } from "./reorder";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("dropping a row among its siblings", () => {
  describe("which slot the pointer is in", () => {
    // Three rows, 40px tall, starting at y=0 → middles at 20, 60, 100.
    const mids = [20, 60, 100];

    it("is above everything when the pointer is above the first middle", () => {
      expect(insertionFor(mids, 0)).toBe(0);
      expect(insertionFor(mids, 19)).toBe(0);
    });

    it("commits at the halfway point, not on overlap", () => {
      // A drag that has covered less than half of the next row has not yet
      // asked for anything. This is the difference between a list that feels
      // decided and one that flickers under the finger.
      expect(insertionFor(mids, 21)).toBe(1);
      expect(insertionFor(mids, 59)).toBe(1);
      expect(insertionFor(mids, 61)).toBe(2);
    });

    it("is below everything when the pointer is past the last middle", () => {
      expect(insertionFor(mids, 500)).toBe(3);
    });

    it("has no slot to find in an empty list", () => {
      expect(insertionFor([], 42)).toBe(0);
    });
  });

  describe("the list afterwards", () => {
    it("moves a row up", () => {
      expect(moveTo(rows("a", "b", "c"), 2, 0)).toEqual(rows("c", "a", "b"));
    });

    it("moves a row down and lands where the pointer was, not one short", () => {
      // The one that needs the -1. Dragging `a` past `b` means slot 2, and
      // without the shift correction it lands back at index 1 — so the row
      // refuses to move and the drag reads as broken.
      expect(moveTo(rows("a", "b", "c"), 0, 2)).toEqual(rows("b", "a", "c"));
    });

    it("moves a row to the very end", () => {
      expect(moveTo(rows("a", "b", "c"), 0, 3)).toEqual(rows("b", "c", "a"));
    });

    it("leaves the list alone when a row is dropped where it already was", () => {
      expect(moveTo(rows("a", "b", "c"), 1, 1)).toEqual(rows("a", "b", "c"));
      expect(moveTo(rows("a", "b", "c"), 1, 2)).toEqual(rows("a", "b", "c"));
    });

    it("never loses or duplicates a row", () => {
      const before = rows("a", "b", "c", "d", "e");
      for (let from = 0; from < 5; from++) {
        for (let at = 0; at <= 5; at++) {
          const after = moveTo(before, from, at);
          expect(after).toHaveLength(5);
          expect(new Set(after.map((r) => r.id)).size).toBe(5);
        }
      }
    });
  });

  describe("whether to write anything at all", () => {
    it("says nothing moved for a tap", () => {
      const list = rows("a", "b", "c");
      expect(sameOrder(list, moveTo(list, 1, 1))).toBe(true);
    });

    it("says something moved for a real drag", () => {
      const list = rows("a", "b", "c");
      expect(sameOrder(list, moveTo(list, 0, 3))).toBe(false);
    });

    it("does not call two different lists the same order", () => {
      expect(sameOrder(rows("a", "b"), rows("a", "b", "c"))).toBe(false);
    });
  });
});
