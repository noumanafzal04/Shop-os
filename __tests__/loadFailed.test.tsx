import React from "react";
import { Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LoadFailed } from "../src/common/ui/LoadFailed";
import { ThemeProvider } from "../src/theme";
import { ApiError } from "../src/common/types/api";
import { canSearchAddresses, searchAddress } from "../src/services/geo";

/**
 * Three silences that used to look identical on screen.
 *
 *   the list is empty          "No shops around here yet."
 *   the request failed          — nothing —
 *   the request was never made  — nothing —
 *
 * Nine screens had a loading state and an empty state and nothing in between,
 * so a dropped connection was reported to the customer as a fact about the
 * platform: that it has no shops. There is no retry on a fact.
 */

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

const copy = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((n) => n.props.children)
    .flat()
    .filter((x) => typeof x === "string")
    .join(" ");

describe("when a screen could not load its contents", () => {
  it("says so, and names what failed", async () => {
    const tree = await render(<LoadFailed what="your orders" onRetry={jest.fn()} />);

    expect(copy(tree)).toContain("your orders");
    expect(copy(tree)).toMatch(/couldn/i);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("offers a way to try again", async () => {
    const retry = jest.fn();
    const tree = await render(<LoadFailed what="shops" onRetry={retry} />);

    expect(copy(tree)).toContain("Try again");

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("passes on what the server actually said", async () => {
    const tree = await render(
      <LoadFailed
        what="your orders"
        error={new ApiError("Your session has expired.", 401)}
        onRetry={jest.fn()}
      />,
    );

    expect(copy(tree)).toContain("Your session has expired.");

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("does not repeat a 500's own words back at the customer", async () => {
    const tree = await render(
      <LoadFailed
        what="shops"
        error={new ApiError("SQLSTATE[42S02]: Base table not found", 500)}
        onRetry={jest.fn()}
      />,
    );

    const text = copy(tree);
    expect(text).not.toContain("SQLSTATE");
    expect(text).toMatch(/connection/i);

    await ReactTestRenderer.act(() => tree.unmount());
  });
});

describe("address search that cannot be made", () => {
  it("knows it has no provider key", () => {
    // The key is empty in source on purpose — it used to sit here as a literal,
    // which put it in a public repo. See `config.ts`.
    expect(canSearchAddresses()).toBe(false);
  });

  it("answers null rather than an empty list", async () => {
    // `[]` would mean "searched, found nothing", and the screen would tell
    // somebody their street does not exist — for every street, for ever.
    await expect(searchAddress("Zamzama Boulevard")).resolves.toBeNull();
  });
});
