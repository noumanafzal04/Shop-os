import { describe, expect, it } from "vitest";

import { signOutWarning } from "./signOutWarning";

describe("signing out with work still on the till (B50)", () => {
  it("says how much is waiting and that it is safe here", () => {
    const said = signOutWarning(3);
    expect(said.title).toBe("3 sales or shift records are still waiting on this till");
    expect(said.message).toMatch(/stay safe on this device/);
    expect(said.confirmLabel).toBe("Sign out anyway");
  });

  it("speaks of one as one", () => {
    expect(signOutWarning(1).title).toBe("1 sale or shift record is still waiting on this till");
  });
});
