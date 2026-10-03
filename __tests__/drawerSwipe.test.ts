import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * THE WAY IN, BY SWIPE — and the way out.
 *
 * `AppDrawer`'s own note used to end: *"if a swipe-to-open gesture is ever
 * wanted, that is the moment to reconsider, not before."* It was wanted. This
 * is what was built, and these are the three things that each fail SILENTLY
 * on their own — a gesture that never fires looks exactly like a person who
 * did not swipe.
 *
 *   1. the strip   the drawer renders something to attach the gesture to
 *                  while it is CLOSED. It used to render a `<Modal>` with
 *                  `visible={false}`, so there was nothing on screen at the
 *                  one moment a swipe matters.
 *   2. the wiring  `DrawerHost` passes `onOpen`. Without it the strip is not
 *                  rendered at all — deliberate, and indistinguishable from
 *                  the feature being absent.
 *   3. the yield   the gesture gives up on a vertical drag. Without
 *                  `failOffsetY` no screen can be scrolled near its left
 *                  edge, which is a worse bug than the missing feature.
 */

const drawer = codeOnly(
  fs.readFileSync(path.join(PROJECT_ROOT, "src/common/components/AppDrawer.tsx"), "utf8"),
);
const host = codeOnly(
  fs.readFileSync(path.join(PROJECT_ROOT, "src/common/components/DrawerHost.tsx"), "utf8"),
);

describe("the closed drawer leaves something to swipe", () => {
  it("renders an edge catcher instead of nothing", () => {
    expect(drawer).toMatch(/if \(!open\) \{/);
    expect(drawer).toMatch(/<GestureDetector gesture=\{edge\}>/);
  });

  it("renders NOTHING when the screen did not ask for the gesture", () => {
    // Not "an inert strip". A screen whose content is a horizontal pager
    // wants the edge for the pager, and a dead view over it is still in the
    // way of the hit test.
    expect(drawer).toMatch(/if \(!onOpen\) return null;/);
  });

  it("gives the strip a real width at the left edge", () => {
    // Zero width is the shape this bug takes when it returns: the strip is
    // invisible either way, and only its width decides whether a thumb lands
    // on it.
    const style = drawer.slice(drawer.indexOf("edge: {"), drawer.indexOf("panel: {"));
    expect(style).toMatch(/position: "absolute"/);
    expect(style).toMatch(/left: 0/);
    expect(style).toMatch(/width: EDGE_WIDTH/);
    expect(drawer).toMatch(/const EDGE_WIDTH = (1[5-9]|2\d|3[0-2]);/);
  });
});

describe("both directions work, and neither steals the page", () => {
  it("yields when the finger goes down instead of across", () => {
    for (const name of ["const edge = Gesture.Pan()", "const shut = Gesture.Pan()"]) {
      const g = drawer.slice(drawer.indexOf(name), drawer.indexOf(name) + 900);
      // Both halves, and the pair is the point: `activeOffsetX` alone claims
      // every downward drag that drifts twelve points sideways.
      expect(g).toMatch(/\.activeOffsetX\(/);
      expect(g).toMatch(/\.failOffsetY\(/);
      // The panel is a native-driver `Animated.Value`, which a Reanimated
      // worklet cannot write to. Dropping this makes the gesture appear to do
      // nothing, with no error anywhere.
      expect(g).toMatch(/\.runOnJS\(true\)/);
    }
  });

  it("puts the panel back if the system takes the gesture away", () => {
    // Backgrounding the app mid-drag used to leave a sliver of panel over the
    // screen with nothing coming to finish the animation.
    expect(drawer).toMatch(/\.onFinalize\(/);
  });

  it("settles through onClose rather than animating behind the parent's back", () => {
    // `open` is held by `DrawerHost`. Animating shut without telling it
    // leaves the panel hidden and the host still believing it is showing —
    // and the next tap on the hamburger then does nothing at all.
    expect(drawer).toMatch(/onCloseRef\.current\(\);/);
  });
});

describe("the host actually wired it", () => {
  it("passes onOpen as well as onClose", () => {
    const el = host.slice(host.indexOf("<AppDrawer"), host.indexOf("<AppDrawer") + 300);
    expect(el).toMatch(/onOpen=\{open\}/);
  });
});
