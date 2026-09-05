import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { ThemeProvider } from "../src/theme";
import {
  Skeleton,
  SkeletonListRow,
  SkeletonMenuRow,
  SkeletonStatusCard,
} from "../src/common/ui/Skeleton";

/**
 * Loading placeholders, and the rule that makes them worth having.
 *
 * A skeleton exists to hold the shape of what is coming. One that holds a
 * different shape does two things wrong: the page jumps when the data lands,
 * and for the second before that it describes something that is not on its way.
 *
 * `SkeletonCard` drew a card with a 120-tall photograph in it and was used by
 * the orders and reservations lists — neither of which has a picture anywhere.
 * It looked fine, because a grey rectangle always does.
 */

const ROOT = PROJECT_ROOT;

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider>
        <ThemeProvider>{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

describe("every skeleton is one somebody waits behind", () => {
  it("has a real screen using it", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/common/ui/Skeleton.tsx"), "utf8");
    const exported = [...source.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);

    // A count of findings is not evidence without a count of attempts.
    expect(exported.length).toBeGreaterThan(2);

    const screens = sourceFiles(path.join(ROOT, "src"))
      .filter((f) => !f.endsWith("Skeleton.tsx"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");

    const orphans = exported.filter((name) => !new RegExp(`<${name}[\\s/>]`).test(screens));

    // An unused placeholder is not harmless: the next screen that reaches for
    // it inherits whatever shape it happens to have, which is how one card with
    // a photograph came to stand in for two lists that have none.
    expect(orphans.join(", ")).toBe("");
  });
});

describe("what each one draws", () => {
  it("renders a shop row without needing a width", async () => {
    const tree = await render(<SkeletonListRow />);
    expect(tree.toJSON()).toBeTruthy();
    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("gives the order card a totals row and the reservation card none", async () => {
    const withTotal = await render(<SkeletonStatusCard footer />);
    const without = await render(<SkeletonStatusCard />);

    // The one honest difference between the two cards. If this stops being
    // true, one component is standing in for two shapes again.
    const count = (t: ReactTestRenderer.ReactTestRenderer) =>
      t.root.findAllByType(Skeleton).length;

    expect(count(withTotal)).toBeGreaterThan(count(without));

    await ReactTestRenderer.act(() => {
      withTotal.unmount();
      without.unmount();
    });
  });

  it("draws a menu line with its picture and its add button", async () => {
    const tree = await render(<SkeletonMenuRow />);

    // Name, description, price, thumbnail, and the round + over its corner.
    expect(tree.root.findAllByType(Skeleton).length).toBe(5);

    await ReactTestRenderer.act(() => tree.unmount());
  });
});
