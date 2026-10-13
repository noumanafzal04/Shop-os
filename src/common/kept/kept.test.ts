import { describe, expect, it } from "vitest";

import { believedAt, heldFor, isDue, ownerOf, stillStands, type KeptRecord } from "./kept";

/**
 * The rules under everything the shell keeps between loads. Pure, so each can
 * be read as a sentence.
 */

describe("whose a kept answer is", () => {
  it("is one person in one shop", () => {
    expect(ownerOf("t1", "u1")).toBe("t1:u1");
  });

  it("is still somebody for a person in no shop — the platform's staff, a customer", () => {
    expect(ownerOf(null, "u1")).toBe("-:u1");
    expect(ownerOf(undefined, "u1")).toBe("-:u1");
  });

  it("is nobody while no person is signed in", () => {
    expect(ownerOf("t1", null)).toBeNull();
    expect(ownerOf("t1", undefined)).toBeNull();
    expect(ownerOf("t1", "")).toBeNull();
  });
});

describe("reading what is kept", () => {
  const record: KeptRecord = { owner: "t1:u1", held: { settings: { data: { tax: 5 }, at: 1000 } } };

  it("hands its owner the answer", () => {
    expect(heldFor(record, "t1:u1", "settings")).toEqual({ data: { tax: 5 }, at: 1000 });
  });

  it("hands another shop nothing", () => {
    expect(heldFor(record, "t2:u1", "settings")).toBeNull();
  });

  it("hands another person in the same shop nothing", () => {
    expect(heldFor(record, "t1:u2", "settings")).toBeNull();
  });

  it("hands nobody nothing", () => {
    expect(heldFor(record, null, "settings")).toBeNull();
    expect(heldFor(null, "t1:u1", "settings")).toBeNull();
  });

  it("has nothing under a name that was never kept", () => {
    expect(heldFor(record, "t1:u1", "branches")).toBeNull();
  });
});

describe("how old a kept answer is believed to be", () => {
  it("is as old as it says", () => {
    expect(believedAt(1000, 5000)).toBe(1000);
    expect(believedAt(5000, 5000)).toBe(5000);
  });

  it("is OLD when it claims to come from the future — the clock was put back", () => {
    // Believing it would hold the answer fresh for as long as the difference.
    expect(believedAt(9000, 5000)).toBe(0);
  });
});

describe("whether something is due again", () => {
  const every = 5 * 60_000;
  const now = 10_000_000;

  it("is due when it was never done", () => {
    expect(isDue(null, now, every)).toBe(true);
    expect(isDue(undefined, now, every)).toBe(true);
    expect(isDue(Number.NaN, now, every)).toBe(true);
  });

  it("is not due inside the interval", () => {
    expect(isDue(now - 1, now, every)).toBe(false);
    expect(isDue(now - (every - 1), now, every)).toBe(false);
    expect(isDue(now, now, every)).toBe(false);
  });

  it("is due on the interval and after it", () => {
    expect(isDue(now - every, now, every)).toBe(true);
    expect(isDue(now - every * 3, now, every)).toBe(true);
  });

  it("is due when it was last done in the future — a clock put back must not silence it", () => {
    expect(isDue(now + 60_000, now, every)).toBe(true);
  });
});

describe("whether an answer still stands under the server's stamp", () => {
  it("stands while the stamp is the one it was heard under", () => {
    expect(stillStands("aaaa", "aaaa")).toBe(true);
  });

  it("does not stand once the stamp has moved on", () => {
    expect(stillStands("aaaa", "bbbb")).toBe(false);
  });

  it("stands when it was heard under no stamp — kept before stamps, or from a server that sends none", () => {
    expect(stillStands(undefined, "bbbb")).toBe(true);
    expect(stillStands(null, "bbbb")).toBe(true);
  });

  it("stands when the device has been sent no stamp to compare with", () => {
    expect(stillStands("aaaa", null)).toBe(true);
    expect(stillStands("aaaa", undefined)).toBe(true);
    expect(stillStands(undefined, undefined)).toBe(true);
  });
});
