import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../App";
import { ThemeProvider, useColors, darkColors, lightColors } from "../src/theme";
import { BusinessAccountScreen } from "../src/modules/auth/screens/BusinessAccountScreen";

/**
 * `ThemeProvider` existed, was exported, was documented as "the only way a
 * component should learn a colour" — and was mounted nowhere. Dark mode could
 * not work, and `useColors()` threw for anyone who took the docblock at its
 * word. Every screen had quietly settled for the deprecated static light
 * palette, which is why the app looked fine and the feature did not exist.
 *
 * These tests are the difference between that being fixed and that being
 * fixed today.
 */

describe("the theme is actually mounted", () => {
  it("wraps the app exactly once", async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<App />);
    });

    // Once, not "at least once": two providers means an inner one silently
    // wins and the outer one's preference is dead state.
    expect(tree.root.findAllByType(ThemeProvider)).toHaveLength(1);

    // A mounted tree holds animations, listeners and retry timers — see
    // App.test.tsx for the five minutes that cost.
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  });

  it("lets a screen read colours without throwing", async () => {
    // The screen that actually calls `useColors`. Before the provider was
    // mounted this threw the moment a shop's account signed in.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    let tree!: ReactTestRenderer.ReactTestRenderer;
    let threw: unknown = null;
    try {
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <SafeAreaProvider>
            <QueryClientProvider client={client}>
              <ThemeProvider>
                <BusinessAccountScreen />
              </ThemeProvider>
            </QueryClientProvider>
          </SafeAreaProvider>,
        );
      });
    } catch (e) {
      threw = e;
    }

    expect(threw).toBeNull();

    await ReactTestRenderer.act(() => {
      tree?.unmount();
    });
  });

  it("refuses to guess a palette when there is no provider", async () => {
    const Probe = () => {
      useColors();
      return null;
    };

    // Loud, not a light-mode fallback: a silent default means a whole subtree
    // renders in the wrong theme and nobody finds out until a screenshot.
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    let message = "";
    try {
      await ReactTestRenderer.act(() => {
        ReactTestRenderer.create(<Probe />);
      });
    } catch (e) {
      message = (e as Error).message;
    }
    quiet.mockRestore();

    expect(message).toMatch(/ThemeProvider/);
  });
});

describe("both themes are complete and distinct", () => {
  // A key present in one and missing from the other is a crash on exactly one
  // theme — the one nobody develops in.
  it("defines every colour in both", () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it.each([
    ["bg", "the page"],
    ["surface", "cards"],
    ["text", "body copy"],
    ["border", "the hairline that replaces shadows"],
    ["primary", "the brand"],
  ] as const)("gives %s (%s) a different value per theme", (key, _role) => {
    // Not a style opinion: a token that survived a dark pass unchanged is a
    // token the pass MISSED, and it will be near-black on near-black.
    expect(darkColors[key]).not.toBe(lightColors[key]);
  });

  it("keeps the brand scale's index meaning the same job in both", () => {
    // 500 is "the brand at full strength" in both, and five hundred call sites
    // ask for it by that number. It must not be one theme's pigment.
    expect(lightColors.primary).toBe(lightColors.brand[500]);
    expect(darkColors.primary).toBe(darkColors.brand[500]);
    expect(darkColors.brand[500]).not.toBe(lightColors.brand[500]);
  });

  it("never leaves text the same colour as the ground it sits on", () => {
    for (const theme of [lightColors, darkColors]) {
      expect(theme.text).not.toBe(theme.bg);
      expect(theme.text).not.toBe(theme.surface);
      expect(theme.onPrimary).not.toBe(theme.primary);
    }
  });
});
