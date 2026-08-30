import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertSessionIsFresh } from "./api";

/**
 * THE GUARD THAT COVERS THE SPEC THAT NEEDED IT.
 *
 * `api.ts` has always refused to hand out a token from a sign-in older than
 * fifty-five minutes, because access tokens live sixty. But `chrome.spec` —
 * forty-eight screens at four sizes, the longest thing in the suite — never
 * asks for a token, so that check could not fire there. Twice now, a run that
 * overran the hour has had this spec report the SIGNED-OUT SHELL as product
 * defects: "2/5 controls unnamed" on every screen, and timeouts.
 *
 * Tested here rather than through a run, because a run re-mints the session as
 * its first step: `auth.setup` is a dependency of every project, so backdating
 * the file and starting playwright simply overwrites it. The only honest way to
 * make this fail is to hand the function an old file directly.
 */

function sessionFileAged(minutes: number): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sess-")), "owner.json");
  fs.writeFileSync(file, "{}");
  const when = new Date(Date.now() - minutes * 60_000);
  fs.utimesSync(file, when, when);

  return file;
}

describe("a run must not outlive its own sign-in", () => {
  it("refuses a session old enough for the token to have died", () => {
    expect(() => assertSessionIsFresh(sessionFileAged(70)))
      .toThrow(/70 minutes old/);
  });

  it("says WHY, so the failure is not read as a product defect", () => {
    // The whole point. "expected 5 to be 3" sends somebody into the app; this
    // sends them back to the run.
    expect(() => assertSessionIsFresh(sessionFileAged(90)))
      .toThrow(/signed-out shell/);
  });

  it("lets a fresh session through", () => {
    // The denominator: a guard that always throws would pass both cases above
    // and stop the suite dead.
    expect(() => assertSessionIsFresh(sessionFileAged(2))).not.toThrow();
  });

  it("is still passing at the edge it was tuned to", () => {
    // 55 minutes of headroom against a 60-minute token. A test at 54 and 56
    // pins the boundary, so moving it is a decision rather than a slip.
    expect(() => assertSessionIsFresh(sessionFileAged(54))).not.toThrow();
    expect(() => assertSessionIsFresh(sessionFileAged(56))).toThrow();
  });
});
