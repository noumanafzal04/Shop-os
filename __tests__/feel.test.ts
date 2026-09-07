import { PROJECT_ROOT, fs, path, sourceFiles, codeOnly } from "./support/node";

/**
 * THE APP ANSWERS WHEN YOU TOUCH IT.
 *
 * ── The measurement this started from ────────────────────────────────
 *
 * A hundred and seventeen `Pressable`s, seventeen of which reacted to being
 * pressed. Every shop row, every product tile, every order in the list did
 * nothing at all under a finger — tap, and either the screen changes a moment
 * later or it does not, with no way to tell which until it happens.
 *
 * Nothing about that is slow. It is SILENT, and silence reads as slow. Closing
 * that gap is most of the difference between an app that feels made and one
 * that feels like a web page in a frame, and it is exactly the kind of thing
 * that gets quietly dropped on the next screen somebody adds.
 *
 * So: a rule, in a test, rather than a note in a review.
 */

const ROOT = PROJECT_ROOT;


/**
 * A style name that means "a thing somebody taps to go somewhere".
 *
 * Deliberately narrow. An icon button, a chip, a close cross — those are small
 * and a scale on them reads as a twitch; the rule is about the big surfaces
 * whose silence is most noticeable.
 */
const SURFACE = /styles\.(\w*(?:card|row|tile|shop|deal|job|item)\w*)/i;

describe("a card or a row reacts to being pressed", () => {
  const files = sourceFiles(path.join(ROOT, "src")).filter((f) => f.endsWith(".tsx"));

  it("scanned the components", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("recognises both shapes when it sees them", () => {
    // The detector, checked against a known-bad line and a known-good one, so
    // a regex that stops matching fails HERE rather than passing everywhere.
    expect(SURFACE.test("<Pressable style={styles.shopCard} onPress={go}>")).toBe(true);
    expect(SURFACE.test("<Pressable style={styles.back} hitSlop={8}>")).toBe(false);
  });

  it("has no big tappable surface that stays still", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));

      // Each `<Pressable …>` opening tag, whole.
      for (const m of src.matchAll(/<Pressable\b[\s\S]*?>/g)) {
        const tag = m[0];
        if (!SURFACE.test(tag)) continue;

        // Two ways to answer a press, and both count: the style itself can be
        // a function of `pressed`, or the element can be a `Touchable`, which
        // scales and dims on the native driver.
        if (/\(\s*\{\s*pressed/.test(tag)) continue;

        const line = src.slice(0, m.index ?? 0).split("\n").length;
        offenders.push(`  ${path.relative(ROOT, file)}:${line}`);
      }
    }

    expect(offenders.join("\n")).toBe("");
  });

  it("keeps the style prop where a Pressable would have put it", () => {
    /**
     * THE REGRESSION THIS EXISTS BECAUSE OF.
     *
     * `Touchable` first put the caller's style on an INNER `Animated.View` and
     * left the `Pressable` bare — sound reasoning about touch targets, and it
     * broke the home screen. A bare Pressable is a content-sized box in every
     * flex row and grid it sits in, so `width: "48%"` on the card inside it
     * resolved against the wrong parent and the layout collapsed.
     *
     * A style prop is a LAYOUT contract as much as a visual one. A drop-in
     * replacement for `Pressable` that moves it one level down is not a
     * drop-in replacement.
     */
    const src = codeOnly(fs.readFileSync(path.join(ROOT, "src/common/ui/Touchable.tsx"), "utf8"));

    // The style and the animation land on the SAME element.
    expect(src).toMatch(/<AnimatedPressable[\s\S]*?style=\{\[style,\s*\{\s*opacity: dim/);
    // …and nothing wraps the children in a second layout box.
    expect(src).not.toMatch(/<Animated\.View style=\{\[style/);
  });

  it("does not rebuild its animated component on every render", () => {
    // `createAnimatedComponent` inside the body returns a new component TYPE
    // each render, and React unmounts and remounts the whole subtree — on a
    // list, that is every card, every frame.
    const src = codeOnly(fs.readFileSync(path.join(ROOT, "src/common/ui/Touchable.tsx"), "utf8"));
    const at = src.indexOf("createAnimatedComponent");
    const fn = src.indexOf("export function Touchable");

    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(fn); // declared after the component, at module scope
    expect(src).toMatch(/^const AnimatedPressable = Animated\.createAnimatedComponent/m);
  });

  it("uses the shared one rather than a fresh copy of the animation", () => {
    // Six screens each springing their own `Animated.Value` on press is six
    // curves that will drift apart. One component owns the feel.
    const users = files.filter((f) =>
      /from "[^"]*common\/ui\/Touchable"/.test(fs.readFileSync(f, "utf8")),
    );

    expect(users.length).toBeGreaterThanOrEqual(4);
  });
});

describe("an entrance plays once", () => {
  const appear = fs.readFileSync(path.join(ROOT, "src/common/ui/Appear.tsx"), "utf8");

  it("guards against a recycled row replaying it", () => {
    // `FlatList` reuses rows. Without this, scrolling back up replays the
    // entrance on rows that have been on screen for a minute — the single
    // most common way this effect goes from pleasant to broken.
    expect(codeOnly(appear)).toMatch(/played\.current/);
  });

  it("stops the stagger climbing", () => {
    // `index * 45ms` is lovely for six rows and absurd for sixty: the last one
    // would arrive nearly three seconds after the first, which is not a
    // flourish, it is a wait.
    expect(codeOnly(appear)).toMatch(/Math\.min\(index, MAX_STAGGERED\)/);
  });

  it("animates only what the native driver can carry", () => {
    // `opacity` and `transform` are the two properties this app can animate
    // off the JS thread. An entrance that stutters while a list renders is
    // worse than none.
    expect(codeOnly(appear)).toMatch(/useNativeDriver: true/);
    expect(codeOnly(appear)).not.toMatch(/height:|width:|margin/);
  });
});

describe("every overlay behaves like the others", () => {
  const files = sourceFiles(path.join(ROOT, "src")).filter((f) => f.endsWith(".tsx"));

  it("scanned the components", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("has no panel riding on the platform's own slide", () => {
    /**
     * THE ONE THAT WAS DIFFERENT, on the interaction that happens most.
     *
     * The filter sheet, the sort sheet, the side menu and the toast are each
     * one `Animated` value on the native driver: a spring on release, a
     * backdrop whose opacity is interpolated from the panel's own position,
     * and a drag to dismiss. `ProductSheet` — opened by every product tap in
     * the app — was `<Modal animationType="slide">`, which cannot be dragged,
     * does not fade its backdrop, and stops linearly instead of settling.
     *
     * Nothing about that is slow. It is INCONSISTENT, and an app where the
     * most-used sheet is the one that behaves differently reads as unfinished
     * however good the other four are.
     *
     * `animationType="none"` is the CORRECT value here, not the absence of a
     * decision: a Modal in this app is a bare container for something that
     * animates itself. Anything else means the platform is running a second
     * entrance over the top of ours, at its own speed.
     */
    const offenders = files
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /animationType=/.test(line) && !/animationType="none"/.test(line))
          .map(([n, line]) => `  ${path.relative(ROOT, f)}:${n}  ${line.trim()}`),
      );

    expect(offenders.join("\n")).toBe("");
  });

  it("drives every overlay off the JS thread", () => {
    // A backdrop that stutters while a list is still rendering behind it is
    // the single most noticeable jank in an app of this shape.
    for (const rel of [
      "src/common/ui/BottomSheet.tsx",
      "src/navigation/SideMenu.tsx",
      "src/common/ui/toast/ToastHost.tsx",
      "src/common/ui/ModeSwitchCover.tsx",
    ]) {
      const src = codeOnly(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      expect(`${rel}: ${/useNativeDriver: true/.test(src)}`).toBe(`${rel}: true`);
      expect(`${rel}: ${/useNativeDriver: false/.test(src)}`).toBe(`${rel}: false`);
    }
  });

  it("keeps a sheet mounted long enough to animate out", () => {
    // Unmounting on the visible prop is why a sheet VANISHES instead of
    // closing — the most common way a good exit animation is never seen.
    const src = codeOnly(fs.readFileSync(path.join(ROOT, "src/common/ui/BottomSheet.tsx"), "utf8"));
    expect(src).toMatch(/const \[mounted, setMounted\] = useState\(visible\)/);
    expect(src).toMatch(/animateOut/);
  });

  it("lets a sheet be dragged shut, not only pressed shut", () => {
    // The gesture anybody who has used one sheet will try on the next.
    const src = codeOnly(fs.readFileSync(path.join(ROOT, "src/common/ui/BottomSheet.tsx"), "utf8"));
    expect(src).toMatch(/PanResponder\.create/);
    expect(src).toMatch(/Animated\.spring/);
  });
});

describe("a picture arrives without a bang", () => {
  const img = codeOnly(
    fs.readFileSync(path.join(ROOT, "src/common/ui/SmartImage.tsx"), "utf8"),
  );

  it("fades in rather than popping", () => {
    expect(img).toMatch(/onLoad=/);
    expect(img).toMatch(/useNativeDriver: true/);
  });

  it("has an answer for a broken link", () => {
    // Not optional on a marketplace: a deleted file, an expired URL, a shop
    // that typed one in. Without this the hole is permanent.
    expect(img).toMatch(/onError=/);
  });

  it("keeps the fallback underneath rather than swapping to it", () => {
    // Unmounting the fallback the moment the image loads is what causes the
    // one-frame flash of page colour between the two — and if the image later
    // fails to decode there is nothing left under it.
    expect(img).toMatch(/position: "absolute"/);
    expect(img).not.toMatch(/failed \? .* : <Animated\.Image/);
  });
});
