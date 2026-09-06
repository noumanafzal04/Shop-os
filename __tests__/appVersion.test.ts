import { PROJECT_ROOT, fs, path } from "./support/node";
import { BRAND } from "../src/common/brand";

/**
 * THE NUMBER SOMEBODY READS OUT ON A SUPPORT CALL.
 *
 * The account page shows a version, and a version is only worth showing if it
 * is the version that is actually installed. JavaScript cannot see Gradle's
 * `versionName` — that would take a native module this app does not have — so
 * the string is stated in `BRAND` and this test is what stops the two drifting.
 *
 * Without it the failure is silent and permanent: the app says 1.0 for ever
 * while the phone runs 2.3, and every bug report is filed against the wrong
 * build.
 */

const gradle = fs.readFileSync(
  path.join(PROJECT_ROOT, "android/app/build.gradle"),
  "utf8",
);

describe("the version the app shows", () => {
  it("finds the one Android actually ships", () => {
    // The denominator. If this file moves or the property is renamed, the
    // comparison below would pass by comparing against nothing.
    expect(gradle).toMatch(/versionName\s+"/);
  });

  it("is the same one", () => {
    const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
    expect(versionName).toBe(BRAND.version);
  });
});
