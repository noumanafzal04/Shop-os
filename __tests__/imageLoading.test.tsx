import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { PROJECT_ROOT, fs, path } from "./support/node";
import { ThemeProvider } from "../src/theme";
import { SmartImage } from "../src/common/ui/SmartImage";

/**
 * WHILE THE PICTURE IS STILL COMING.
 *
 * ── The state the placeholder could not express ──────────────────────
 *
 * One tinted ground with a letter on it answered three different questions —
 * "loading", "failed", "this shop has no photograph" — which means it answered
 * none of them. On a shop that HAS pictures, on a slow connection, a grid of
 * motionless letters is indistinguishable from a shop that uploaded nothing,
 * and somebody stops waiting for something that was on its way.
 *
 * The rule: a sweep runs while, and only while, a picture is coming. The three
 * negatives below are the whole rule — shimmering where nothing is on its way
 * promises a photograph that does not exist.
 */

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

/** Lay the container out, which is what lets the sweep know how far to travel. */
async function layOut(tree: ReactTestRenderer.ReactTestRenderer, width = 120) {
  const wrap = tree.root.findAllByType("View" as never)[0];
  await ReactTestRenderer.act(() => {
    wrap.props.onLayout?.({ nativeEvent: { layout: { width, height: 90 } } });
  });
}

/** The sweep is the one absolutely-positioned View that is not the image. */
const sweeps = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType("View" as never).filter((v) => {
    const flat = [v.props.style].flat(3).filter(Boolean);
    return flat.some((s: any) => s?.position === "absolute") && v.props.pointerEvents === "none";
  });

describe("a picture on its way says so", () => {
  it("sweeps while the image is loading", async () => {
    const tree = await render(<SmartImage uri="https://x/a.jpg" fallback="A" />);
    await layOut(tree);
    expect(sweeps(tree)).toHaveLength(1);
  });

  it("stops the moment the image lands", async () => {
    const tree = await render(<SmartImage uri="https://x/a.jpg" fallback="A" />);
    await layOut(tree);

    const img = tree.root.findAllByType("Image" as never)[0];
    await ReactTestRenderer.act(() => {
      img.props.onLoad?.();
    });

    expect(sweeps(tree)).toHaveLength(0);
  });

  it("stops when the link is broken, because nothing more is coming", async () => {
    const tree = await render(<SmartImage uri="https://x/gone.jpg" fallback="A" />);
    await layOut(tree);

    const img = tree.root.findAllByType("Image" as never)[0];
    await ReactTestRenderer.act(() => {
      img.props.onError?.();
    });

    expect(sweeps(tree)).toHaveLength(0);
    // …and the letter is still there. Unmounting the fallback is what leaves a
    // hole when an image fails after it has already started.
    expect(tree.root.findAllByType("Text" as never)[0].props.children).toBe("A");
  });

  it("never sweeps where there is no picture to wait for", async () => {
    // A shop that has uploaded nothing. The letter is the ANSWER here, not a
    // placeholder, and a shimmer over it promises something that will never
    // arrive — which is the same lie the still block told, in the other
    // direction.
    const tree = await render(<SmartImage uri={null} fallback="A" />);
    await layOut(tree);
    expect(sweeps(tree)).toHaveLength(0);
  });

  it("waits for its own layout before starting", async () => {
    // A band that begins mid-slide, because it was drawn before anything knew
    // how wide it had to travel, reads as a flicker.
    const tree = await render(<SmartImage uri="https://x/a.jpg" fallback="A" />);
    expect(sweeps(tree)).toHaveLength(0);
    await layOut(tree);
    expect(sweeps(tree)).toHaveLength(1);
  });

  it("starts over when the picture changes", async () => {
    const tree = await render(<SmartImage uri="https://x/a.jpg" fallback="A" />);
    await layOut(tree);
    await ReactTestRenderer.act(() => {
      tree.root.findAllByType("Image" as never)[0].props.onLoad?.();
    });
    expect(sweeps(tree)).toHaveLength(0);

    // A different URL is a different photograph, and it is on its way.
    await ReactTestRenderer.act(() => {
      tree.update(
        <ThemeProvider>
          <SmartImage uri="https://x/b.jpg" fallback="A" />
        </ThemeProvider>,
      );
    });
    await layOut(tree);
    expect(sweeps(tree)).toHaveLength(1);
  });
});

describe("one animation, shared", () => {
  const codeOnly = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("drives the sweep from the skeletons' own hook", () => {
    // Two loading animations on one card at two different speeds is worse than
    // either alone — a product tile shows a skeleton and then a SmartImage in
    // the same second.
    const src = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/common/ui/SmartImage.tsx"), "utf8"),
    );
    expect(src).toMatch(/import \{ useShimmer \} from "\.\/Skeleton"/);
    expect(src).toMatch(/const \{ progress, still \} = useShimmer\(\)/);
    // Reduce motion is honoured by NOT drawing it, not by slowing it down.
    expect(src).toMatch(/waiting && ! ?still && measured > 0/);
  });

  it("animates only what the native driver can carry", () => {
    const src = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/common/ui/SmartImage.tsx"), "utf8"),
    );
    // `opacity` and `transform` are the two this app can drive off the JS
    // thread. A sweep that stutters while a list scrolls is worse than none.
    expect(src).toMatch(/useNativeDriver: true/);
    expect(src).not.toMatch(/animate.*\b(width|height|margin)\b/);
  });
});
