import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useFillOnce } from "./useFillOnce";

/** A refetch must not put the server's values back under somebody's hand (L10). */
describe("filling an edit form", () => {
  it("fills when the record arrives, not again when it is fetched again", () => {
    const fill = vi.fn();
    const { rerender } = renderHook(({ r }) => useFillOnce(r, fill), { initialProps: { r: undefined as { id: string; is_active: boolean } | undefined } });
    expect(fill).not.toHaveBeenCalled();

    rerender({ r: { id: "p1", is_active: true } });
    rerender({ r: { id: "p1", is_active: true } }); // the catalogue sync's refetch: a new object, the same item
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it("fills again when a different record is opened", () => {
    const fill = vi.fn();
    const { rerender } = renderHook(({ r }) => useFillOnce(r, fill), { initialProps: { r: { id: "p1" } } });
    rerender({ r: { id: "p2" } });
    expect(fill.mock.calls.map(([r]) => r.id)).toEqual(["p1", "p2"]);
  });
});
