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
  it("moves when a build ships", () => {
    /**
     * WHY THIS ROUND COST FOUR BUILDS.
     *
     * Five APKs went out saying `1.0`, `versionCode 1`. Nothing on the phone,
     * and nothing I could ask for, distinguished them — so a crash reported
     * against "the app" could have been any of five builds, and the one that
     * was actually installed was an old one whose fix had already shipped
     * twice.
     *
     * A version is not paperwork. It is the only thing that makes a bug report
     * about a specific artefact instead of about a name.
     */
    expect(BRAND.version).not.toBe("1.0");
    // Three parts, so a fix has somewhere to go without pretending to be a
    // feature release.
    expect(BRAND.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("moves the number ANDROID compares, not only the one people read", () => {
    // `versionName` is a label; `versionCode` is what decides whether an
    // install is an update. Ship a new name on the old code and the phone can
    // refuse the install, or take it and keep the old permissions grant.
    const code = /versionCode\s+(\d+)/.exec(gradle)?.[1];
    expect(code).toBeDefined();
    expect(Number(code)).toBeGreaterThan(1);
  });

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
