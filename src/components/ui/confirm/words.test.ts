import { describe, expect, it } from "vitest";

import { dismissLabel } from "./words";

describe("what the no button says", () => {
  it("says Cancel when the question is about anything else", () => {
    expect(dismissLabel({ confirmLabel: "Void" })).toBe("Cancel");
    expect(dismissLabel({ confirmLabel: "Delete supplier" })).toBe("Cancel");
    expect(dismissLabel({})).toBe("Cancel");
  });

  it("does not say Cancel beside a yes that cancels something", () => {
    expect(dismissLabel({ confirmLabel: "Cancel tab" })).toBe("Keep it");
    expect(dismissLabel({ confirmLabel: "Cancel count" })).toBe("Keep it");
    expect(dismissLabel({ confirmLabel: "  cancel the order" })).toBe("Keep it");
  });

  it("is not fooled by a word that only starts the same way", () => {
    expect(dismissLabel({ confirmLabel: "Cancellation fee" })).toBe("Cancel");
  });

  it("leaves a screen's own words alone", () => {
    expect(dismissLabel({ confirmLabel: "Cancel the shift", cancelLabel: "Leave it running" })).toBe("Leave it running");
    expect(dismissLabel({ confirmLabel: "Delete", cancelLabel: "Not now" })).toBe("Not now");
  });
});
