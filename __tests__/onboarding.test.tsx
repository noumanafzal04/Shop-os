import React from "react";
import ReactTestRenderer from "react-test-renderer";

/**
 * The introduction shows once, and only once.
 *
 * Both halves matter and they fail in opposite directions: shown when it
 * should not be, it covers the whole app on every launch; not shown when it
 * should be, it is three screens of work nobody ever sees. The second is the
 * quiet one, which is why the saved value is asserted here rather than assumed.
 */

jest.mock("../src/modules/auth/hooks/useAuth", () => ({
  ...jest.requireActual("../src/modules/auth/hooks/useAuth"),
  useBootstrapSession: () => {},
}));

jest.mock("../src/common/api/client", () => ({
  apiGet: jest.fn(() => new Promise(() => {})),
  apiPost: jest.fn(() => new Promise(() => {})),
  apiPut: jest.fn(() => new Promise(() => {})),
  apiPatch: jest.fn(() => new Promise(() => {})),
  apiDelete: jest.fn(() => new Promise(() => {})),
  api: { get: jest.fn(), post: jest.fn() },
}));

const mockSaved = { theme: "system" as const, onboarded: false };
const mockSetOnboarded = jest.fn(() => Promise.resolve());

jest.mock("../src/common/utils/prefs", () => ({
  prefs: {
    all: () => Promise.resolve(mockSaved),
    setTheme: () => Promise.resolve(),
    setOnboarded: () => mockSetOnboarded(),
  },
}));

import App from "../App";
import { queryClient } from "../src/common/api/queryClient";
import { OnboardingScreen } from "../src/modules/onboarding/OnboardingScreen";
import { RootNavigator } from "../src/navigation/RootNavigator";

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  return tree;
}

beforeEach(() => {
  mockSetOnboarded.mockClear();
  queryClient.clear();
});

describe("the first launch", () => {
  it("shows the introduction, and holds the app behind it", async () => {
    mockSaved.onboarded = false;
    const tree = await render();

    expect(tree.root.findAllByType(OnboardingScreen)).toHaveLength(1);
    // Not merely covered — not mounted. Fetching a home feed behind a screen
    // nobody has finished reading is work paid for and thrown away.
    expect(tree.root.findAllByType(RootNavigator)).toHaveLength(0);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("remembers, so the second launch goes straight in", async () => {
    mockSaved.onboarded = true;
    const tree = await render();

    expect(tree.root.findAllByType(OnboardingScreen)).toHaveLength(0);
    expect(tree.root.findAllByType(RootNavigator)).toHaveLength(1);

    await ReactTestRenderer.act(() => tree.unmount());
  });
});

describe("skipping it", () => {
  it("both opens the app AND writes it down", async () => {
    mockSaved.onboarded = false;
    const tree = await render();

    // By LABEL, not by serialising the node: once navigators are in the tree
    // `JSON.stringify` on a props object throws on a circular structure, and
    // the failure names the JSON call rather than the query.
    const skip = tree.root.findAllByProps({ accessibilityLabel: "Skip introduction" });
    expect(skip.length).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => {
      skip[0].props.onPress();
    });

    // Doing one without the other is the bug: the app opens and then asks
    // again tomorrow.
    expect(tree.root.findAllByType(RootNavigator)).toHaveLength(1);
    expect(mockSetOnboarded).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(() => tree.unmount());
  });
});
