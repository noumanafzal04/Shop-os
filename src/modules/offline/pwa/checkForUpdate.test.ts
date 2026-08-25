import { describe, expect, it, vi } from "vitest";

import { checkForUpdate, type CheckableRegistration } from "./checkForUpdate";

/**
 * The whole value of this function is that it distinguishes five outcomes a
 * lazier one would collapse into two. So every test here is about one of them
 * NOT being reported as another — telling a shop it is up to date when nobody
 * managed to ask is the failure this exists to prevent.
 */
const reg = (over: Partial<CheckableRegistration> = {}): CheckableRegistration => ({
  update: vi.fn().mockResolvedValue(undefined),
  waiting: null,
  installing: null,
  ...over,
});

const never = () => Promise.resolve();

describe("checking for a newer version", () => {
  it("says a build is waiting when one is", async () => {
    await expect(checkForUpdate(reg({ waiting: {} }))).resolves.toBe("found");
  });

  it("says up to date only after actually asking", async () => {
    const r = reg();
    await expect(checkForUpdate(r)).resolves.toBe("current");
    expect(r.update).toHaveBeenCalled();
  });

  it("does not claim to be up to date when there is no line", async () => {
    // The one that matters. A till offline for the afternoon must not be told
    // it has the newest prices — nobody looked.
    const r = reg();
    await expect(checkForUpdate(r, { isOnline: () => false })).resolves.toBe("offline");
    expect(r.update).not.toHaveBeenCalled();
  });

  it("does not claim to be up to date when there is no worker at all", async () => {
    // This is the state on a plain-http address, where a browser refuses to
    // register one. There is no version to compare against.
    await expect(checkForUpdate(undefined)).resolves.toBe("unavailable");
  });

  it("says the ask failed rather than swallowing it", async () => {
    const r = reg({ update: vi.fn().mockRejectedValue(new Error("no")) });
    await expect(checkForUpdate(r)).resolves.toBe("failed");
  });

  it("waits for a download to land before answering", async () => {
    // A worker found and still installing would otherwise be reported as
    // "up to date" — about a build already on its way in.
    const r = reg({ installing: {} });
    const wait = vi.fn(async () => { r.waiting = {}; r.installing = null; });

    await expect(checkForUpdate(r, { wait, grace: 1000, step: 100 })).resolves.toBe("found");
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("says a download is still going rather than guessing", async () => {
    const r = reg({ installing: {} });

    await expect(checkForUpdate(r, { wait: never, grace: 300, step: 100 }))
      .resolves.toBe("installing");
  });

  it("gives up on a download that dies without producing anything", async () => {
    const r = reg({ installing: {} });
    const wait = vi.fn(async () => { r.installing = null; });

    await expect(checkForUpdate(r, { wait, grace: 1000, step: 100 })).resolves.toBe("installing");
  });
});
