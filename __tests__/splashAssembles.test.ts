import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";
import { MARK_PIECES } from "../src/common/components/BrandMark";

/**
 * "SPLASH WHITE, A GOOD ANIMATION OF THE LOGO — LOGO KO PIECES MAIN DIVIDE
 * KRK SATH JOD SKTY?" The mark is drawn as its three pieces and the splash
 * assembles them on white; the native frame before JavaScript is white too.
 */
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("the splash puts the logo together on white", () => {
  it("the mark is three vector pieces", () => {
    expect(Object.keys(MARK_PIECES)).toEqual(["bar", "stem", "foot"]);
    for (const d of Object.values(MARK_PIECES)) expect(d).toMatch(/^M[\d .A-Za-z-]+Z$/);
  });

  it("each piece arrives on its own, then the name rises; Reduce Motion shows it still", () => {
    const boot = read("src/modules/auth/screens/BootScreen.tsx");
    expect(boot).toMatch(/Animated\.stagger\(140, \[/);
    expect(boot).toMatch(/<MarkPieceSvg piece=\{p\}/);
    expect(boot).toMatch(/isReduceMotionEnabled\(\)/);
    expect(boot).toMatch(/backgroundColor: c\.surface/);
  });

  it("the navigator holds the splash until the logo is whole, with a timer behind it", () => {
    const nav = read("src/navigation/RootNavigator.tsx");
    expect(nav).toMatch(/if \(status === "booting" \|\| !introDone\) return <BootScreen onDone=\{endIntro\} \/>/);
    expect(nav).toMatch(/setTimeout\(endIntro, INTRO_MS \+ 600\)/);
  });

  it("the frame before JavaScript is white, with a dark clock", () => {
    const styles = fs.readFileSync(path.join(PROJECT_ROOT, "android/app/src/main/res/values/styles.xml"), "utf8");
    expect(styles).toMatch(/<item name="android:windowBackground">@color\/splash<\/item>/);
    expect(styles).toMatch(/<item name="android:windowLightStatusBar">true<\/item>/);
    expect(fs.readFileSync(path.join(PROJECT_ROOT, "android/app/src/main/res/values/colors.xml"), "utf8")).toMatch(
      /<color name="splash">#FFFFFF<\/color>/,
    );
  });
});
