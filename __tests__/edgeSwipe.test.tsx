import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { SideMenu } from "../src/navigation/SideMenu";
import { ThemeProvider } from "../src/theme";
import { PROJECT_ROOT, codeOnly, fs, path, statementAt } from "./support/node";

/**
 * THE WAY IN, BY SWIPE.
 *
 * Asked for directly: the sidebar should open on a swipe, not only on the
 * hamburger. Three things have to be true at once for that to work, and each
 * of them fails silently on its own — a gesture that never fires looks
 * exactly like a person who did not swipe.
 *
 *   1. the strip   `SideMenu` renders something for the gesture to attach to
 *                  while it is CLOSED. It used to render `null`, so there was
 *                  nothing on screen at the one moment the swipe matters.
 *   2. the wiring  the screen passes `onOpen`. Without it the strip is not
 *                  rendered at all, which is deliberate — see the prop — and
 *                  indistinguishable from the feature being absent.
 *   3. the yield   the gesture gives up on a vertical drag. Without
 *                  `failOffsetY` the page cannot be scrolled near the left
 *                  edge, which is a worse bug than the missing feature.
 */

/**
 * NAVIGATION, STUBBED FLAT — and `requireActual` is the trap here.
 *
 * This panel reaches `deepLinks.ts` through `useAuth` -> `push.ts`, and that
 * file calls `createNavigationContainerRef` at IMPORT time. A factory with
 * only `useNavigation` in it therefore fails the whole suite before a single
 * case runs, naming a file three imports away from anything being tested.
 *
 * Spreading `requireActual` fixes that and costs a great deal: it loads the
 * real navigation core, which pulls enough of the tree that the run stops
 * finishing. Three stubs are what this file actually needs, so three stubs is
 * what it declares.
 */
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useIsFocused: () => true,
  createNavigationContainerRef: () => ({ isReady: () => false, navigate: jest.fn() }),
}));
async function render(props: Partial<React.ComponentProps<typeof SideMenu>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      /*
        `GestureHandlerRootView` is not test scaffolding — it is the thing the
        app must also have, and the library now THROWS without it rather than
        mounting a handler that silently never fires. `App.tsx` wraps the
        whole tree for exactly this reason; this mirrors it so the test fails
        for the same cause a phone would.
      */
      <GestureHandlerRootView>
        <SafeAreaProvider>
          <ThemeProvider>
            <QueryClientProvider client={client}>
              <SideMenu visible={false} onClose={jest.fn()} {...props} />
            </QueryClientProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>,
    );
  });
  return tree;
}

describe("the closed menu leaves something to swipe", () => {
  it("renders an edge catcher when the screen asked for one", async () => {
    const tree = await render({ onOpen: jest.fn() });

    expect(tree.root.findAllByType(GestureDetector)).toHaveLength(1);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("renders NOTHING when the screen did not", async () => {
    // Not "renders a disabled strip". A screen whose content is itself a
    // horizontal pager wants the edge for the pager, and an inert view over
    // it would still be in the way of the hit test.
    const tree = await render({ onOpen: undefined });

    expect(tree.root.findAllByType(GestureDetector)).toHaveLength(0);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("gives the strip a real width, in a corner of the screen", async () => {
    const tree = await render({ onOpen: jest.fn() });
    const strip = tree.root.findByType(GestureDetector).findByProps({ importantForAccessibility: "no-hide-descendants" });
    const style = Array.isArray(strip.props.style) ? Object.assign({}, ...strip.props.style) : strip.props.style;

    // Zero width is the shape this bug takes when it comes back: the strip is
    // invisible either way, and only its width decides whether a thumb lands
    // on it.
    expect(style.width).toBeGreaterThan(12);
    expect(style.position).toBe("absolute");
    expect(style.left).toBe(0);

    await ReactTestRenderer.act(() => tree.unmount());
  });
});

describe("the gesture yields to the page", () => {
  const menu = codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, "src/navigation/SideMenu.tsx"), "utf8"));

  it("gives up when the finger goes down instead of across", async () => {
    const gesture = statementAt(menu, "const edge = Gesture.Pan()");

    // Both halves, and the pair is the point. `activeOffsetX` alone claims
    // every downward drag that drifts twelve points sideways — which near the
    // left edge is most of them.
    expect(gesture).toMatch(/\.activeOffsetX\(/);
    expect(gesture).toMatch(/\.failOffsetY\(/);
  });

  it("drives the same Animated value the panel already uses", async () => {
    const gesture = statementAt(menu, "const edge = Gesture.Pan()");

    // `runOnJS(true)`: the panel is a native-driver `Animated.Value`, which a
    // Reanimated worklet cannot write to. Dropping this makes the gesture
    // appear to do nothing, with no error anywhere.
    expect(gesture).toMatch(/\.runOnJS\(true\)/);
    expect(gesture).toMatch(/x\.setValue\(/);
  });

  it("puts the panel back if the system takes the gesture away", async () => {
    // Backgrounding the app mid-drag used to leave a sliver of menu over the
    // screen with nothing coming to finish the animation.
    expect(statementAt(menu, "const edge = Gesture.Pan()")).toMatch(/\.onFinalize\(/);
  });
});

describe("the home screen actually wired it", () => {
  it("passes onOpen as well as onClose", () => {
    const home = codeOnly(
      fs.readFileSync(
        path.join(PROJECT_ROOT, "src/modules/marketplace/screens/CustomerHomeScreen.tsx"),
        "utf8",
      ),
    );

    const el = home.slice(home.indexOf("<SideMenu"), home.indexOf("<SideMenu") + 300);
    expect(el).toMatch(/onOpen=\{/);
    // And the hamburger is still there. A gesture nobody is told about is not
    // a control, it is a secret — the swipe is the shortcut, not the door.
    expect(home).toMatch(/accessibilityLabel="Menu"/);
  });
});
