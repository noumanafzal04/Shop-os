import { BRAND } from "../src/common/brand";
import { PRODUCT } from "@cartze/core/brand";
import { PROJECT_ROOT, fs, path } from "./support/node";

/**
 * THE NAME IS IN ONE PLACE, AND THE TWO FILES THAT CANNOT READ IT.
 *
 * `PRODUCT.name` is the only line a rename should touch. Android's
 * `strings.xml` and iOS's `Info.plist` are read by the OS before any
 * JavaScript exists, so they cannot derive it — they have to be edited by
 * hand, which means they are where a rename goes half-done.
 *
 * That used to be a checklist in a comment. A checklist in a comment is a
 * thing somebody reads once; this fails the suite and prints the exact value
 * to paste.
 *
 * ── Why the failure message matters more than the assertion ──────────
 *
 * The whole cost of this bug class is the hunt. "Expected 'CartZe' to be
 * 'True Serve'" in a file nobody was editing is a thirty-second fix only if
 * the message names the file. So each case reports a path and a value rather
 * than two bare strings.
 */

const read = (rel: string) => fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8");

const ANDROID = "android/app/src/main/res/values/strings.xml";
const IOS = "ios/ShoposMobile/Info.plist";

describe("the launcher says what the product is called", () => {
  it("derives this app's name from the one shared constant", () => {
    // Not a literal. A test that hardcodes "True Serve" is a SECOND place the
    // name is written, which is the thing being fixed.
    expect(BRAND.name).toContain(PRODUCT.name);
  });

  it(`matches ${ANDROID}`, () => {
    const label = /<string name="app_name">([^<]*)<\/string>/.exec(read(ANDROID))?.[1];

    expect({ file: ANDROID, app_name: label }).toEqual({ file: ANDROID, app_name: BRAND.name });
  });

  it(`matches ${IOS}`, () => {
    const label = /<key>CFBundleDisplayName<\/key>\s*<string>([^<]*)<\/string>/.exec(read(IOS))?.[1];

    expect({ file: IOS, CFBundleDisplayName: label }).toEqual({
      file: IOS,
      CFBundleDisplayName: BRAND.name,
    });
  });
});

describe("addresses do NOT follow the rename", () => {
  /**
   * The other half of the rule, and the half that costs real data if it is
   * got wrong. `PRODUCT` spells it out: a key something is STORED under is
   * not branding, even when it contains the old name. Renaming one does not
   * move what it points at — it points somewhere empty.
   *
   * So these are asserted to be UNCHANGED. A find-and-replace that swept the
   * repo would sign every user out and orphan the Play listing, and it would
   * do it silently.
   */
  it("keeps the domain and the deep-link scheme", () => {
    expect(PRODUCT.domain).toBe("cartze.shop");
    expect(PRODUCT.scheme).toBe("cartze");
  });

  it("keeps the applicationId the store listing is registered under", () => {
    const gradle = read("android/app/build.gradle");
    expect(gradle).toContain("com.shoposmobile");
  });
});
