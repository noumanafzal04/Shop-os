import React from "react";
import { Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LoadFailed } from "../src/common/ui/LoadFailed";
import { ThemeProvider } from "../src/theme";
import { ApiError } from "../src/common/types/api";

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

/**
 * THE KEY IS A CONFIGURATION, NOT A FACT.
 *
 * These two tests used to assert `canSearchAddresses() === false` and read
 * "the key is empty in source on purpose". That was true of the repository on
 * the day they were written and is not a rule about the app — so the moment a
 * key was actually configured, two tests failed for the one reason a test must
 * never fail: the thing they described had been fixed.
 *
 * What is a rule is the DISTINCTION. `null` means the search could not be
 * made; `[]` means it was made and matched nothing. Without it, an unset key
 * looks exactly like "your street does not exist", for every street, for ever.
 * So both states are set up here explicitly and neither depends on what is
 * sitting in `secrets.ts` today.
 */
describe("address search, with a key and without", () => {
  /**
   * `geo.ts` reads the key at MODULE level, so the config has to be replaced
   * before it is required — hence the isolated registry rather than a spy.
   * Only the three values geo imports are mocked; a `requireActual` spread
   * would pull the API host and the dev-warning side effects in with it.
   */
  function withKeys<T>(
    keys: { MAPS_PROVIDER: "google" | "geoapify"; GOOGLE_MAPS_API_KEY: string; GEOAPIFY_API_KEY: string },
    run: (geo: typeof import("../src/services/geo")) => T,
  ): T {
    let out!: T;
    jest.isolateModules(() => {
      jest.doMock("../src/common/config", () => keys);
      out = run(require("../src/services/geo") as typeof import("../src/services/geo"));
    });
    jest.dontMock("../src/common/config");

    return out;
  }

  const NO_KEY = {
    MAPS_PROVIDER: "google" as const,
    GOOGLE_MAPS_API_KEY: "",
    GEOAPIFY_API_KEY: "",
  };
  const WITH_KEY = {
    MAPS_PROVIDER: "google" as const,
    GOOGLE_MAPS_API_KEY: "test-key",
    GEOAPIFY_API_KEY: "",
  };

  afterEach(() => {
    // @ts-expect-error — the phone has no global fetch to restore.
    delete global.fetch;
  });

  it("knows when it has no provider key", () => {
    expect(withKeys(NO_KEY, (geo) => geo.canSearchAddresses())).toBe(false);
  });

  it("answers null rather than an empty list when it cannot search", async () => {
    // `[]` would mean "searched, found nothing", and the screen would tell
    // somebody their street does not exist.
    await expect(
      withKeys(NO_KEY, (geo) => geo.searchAddress("Zamzama Boulevard")),
    ).resolves.toBeNull();
  });

  it("never reaches the network without a key", async () => {
    const fetchMock = jest.fn();
    // @ts-expect-error — installing a fetch the phone does not have.
    global.fetch = fetchMock;

    await withKeys(NO_KEY, (geo) => geo.searchAddress("Zamzama Boulevard"));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches, and carries the key, once one is configured", async () => {
    /**
     * The half nothing tested. The google branch was written months before a
     * key existed and its own comment said "not used until a key is set" — so
     * the day the provider was switched, the path that had never run once
     * became the only one that runs.
     */
    const fetchMock = jest.fn((_url: string) =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            results: [
              {
                name: "Zamzama Boulevard",
                formatted_address: "Zamzama, Karachi",
                geometry: { location: { lat: 24.8, lng: 67.03 } },
              },
            ],
          }),
      }),
    );
    // @ts-expect-error — installing a fetch the phone does not have.
    global.fetch = fetchMock;

    const found = await withKeys(WITH_KEY, (geo) => geo.searchAddress("Zamzama"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("maps.googleapis.com");
    expect(url).toContain("key=test-key");

    expect(found).toEqual([
      { label: "Zamzama Boulevard", detail: "Zamzama, Karachi", lat: 24.8, lng: 67.03 },
    ]);
  });

  it("answers an empty list, not null, for a query too short to send", async () => {
    // Made and matched nothing versus never made. Two words fewer than the
    // minimum is not a missing key.
    await expect(withKeys(WITH_KEY, (geo) => geo.searchAddress("Za"))).resolves.toEqual([]);
  });
});
