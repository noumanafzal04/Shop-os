import React from "react";
import ReactTestRenderer from "react-test-renderer";

/**
 * Which of the app's three front doors a person lands at.
 *
 * ── What is mocked, and why it is not cheating ─────────────────────────
 *
 * This test is about ROUTING. Two things have to be held still for it to be
 * about that and nothing else:
 *
 *   useBootstrapSession  runs on mount, finds no Keychain tokens and sets the
 *                        status to "guest" — overwriting whatever the test just
 *                        arranged. Left in, the second test could only ever
 *                        assert what the first one does.
 *
 *   the HTTP client      the shopping screens fetch on mount. Against no server
 *                        those fail, React Query retries them on a timer, and
 *                        the timers outlive the test: the suite finished in two
 *                        seconds and Jest then sat for five minutes refusing to
 *                        exit. A leaked timer is a real leak — the app would
 *                        hold it on a phone too — but it belongs to a test about
 *                        fetching, not to this one.
 *
 *   the saved settings   the introduction covers the whole app until it has
 *                        been through once, and an unmocked Keychain reports
 *                        "never onboarded" for ever. Held at "already seen"
 *                        here; `onboarding.test.tsx` is where the other answer
 *                        is checked.
 */
jest.mock("../src/common/utils/prefs", () => ({
  prefs: {
    all: () => Promise.resolve({ theme: "system", onboarded: true }),
    setTheme: () => Promise.resolve(),
    setOnboarded: () => Promise.resolve(),
  },
}));

jest.mock("../src/modules/auth/hooks/useAuth", () => ({
  ...jest.requireActual("../src/modules/auth/hooks/useAuth"),
  useBootstrapSession: () => {},
}));

jest.mock("../src/common/api/client", () => ({
  apiGet: jest.fn(() => new Promise(() => {})), // pending for ever: never resolves, never retries
  apiPost: jest.fn(() => new Promise(() => {})),
  apiPut: jest.fn(() => new Promise(() => {})),
  apiPatch: jest.fn(() => new Promise(() => {})),
  apiDelete: jest.fn(() => new Promise(() => {})),
  api: { get: jest.fn(), post: jest.fn() },
}));

import App from "../App";
import { queryClient } from "../src/common/api/queryClient";
import { useAuthStore } from "../src/stores/authStore";
import { BusinessAccountScreen } from "../src/modules/auth/screens/BusinessAccountScreen";
import { SignInScreen } from "../src/modules/auth/screens/SignInScreen";

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  return tree;
}

async function unmount(tree: ReactTestRenderer.ReactTestRenderer) {
  // Unmounting is how the test asks whether teardown works at all — the tree
  // holds a shimmer animation and a deep-link listener.
  await ReactTestRenderer.act(() => {
    tree.unmount();
  });
}

afterEach(() => {
  queryClient.clear();
  useAuthStore.setState({ status: "guest", user: null });
});

test("a signed-out visitor gets the shop, not a login wall", async () => {
  useAuthStore.setState({ status: "guest", user: null });

  const tree = await render();

  // Browsing without an account is the design: an account is asked for at
  // checkout and at order history, and nowhere else. A sign-in screen standing
  // in front of everything means the old gate is back.
  //
  // Asked by COMPONENT rather than by serialising the tree: the render now
  // contains the navigators' context objects, and those are circular — the
  // first version of this test failed on JSON.stringify, not on the app.
  expect(tree.root.findAllByType(SignInScreen)).toHaveLength(0);
  expect(tree.root.findAllByType(BusinessAccountScreen)).toHaveLength(0);

  await unmount(tree);
});

test("a customer gets the same shop", async () => {
  useAuthStore.setState({
    status: "authenticated",
    user: { id: "u1", role: "customer", name: "Ayesha", permissions: [] } as never,
  });

  const tree = await render();

  // Signing in must not swap the tree — that is why guest and customer share
  // one navigator. See RootNavigator.
  expect(tree.root.findAllByType(BusinessAccountScreen)).toHaveLength(0);

  await unmount(tree);
});

test("a business account is told it is in the wrong app", async () => {
  useAuthStore.setState({
    status: "authenticated",
    user: { id: "u2", role: "shop_owner", name: "Owner", permissions: [] } as never,
  });

  const tree = await render();

  // Not a login error: the credentials were right. Being sent to reset a
  // password that works is the failure this avoids.
  expect(tree.root.findAllByType(BusinessAccountScreen)).toHaveLength(1);

  await unmount(tree);
});
