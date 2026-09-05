import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppButton } from "../src/common/ui/AppButton";

/**
 * Signing in has to CLOSE the screen you signed in on.
 *
 * Guest and customer share one navigator — that is what lets somebody sign in
 * at checkout and come back to their own checkout instead of a home screen.
 * The cost is that a successful login no longer swaps the tree, so nothing
 * dismisses the sheet by itself. The session flips, the form stays exactly
 * where it was, and to the person holding the phone the button did nothing.
 *
 * It shipped that way for one build. This is the test that would have caught
 * it, and it is written against the SUCCESS PATH rather than the render,
 * because the screen looked perfect either way.
 */

const mockGoBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ goBack: mockGoBack, canGoBack: mockCanGoBack, navigate: jest.fn() }),
}));

/** Captures the options a screen passes to `mutate`, so onSuccess can be run. */
const mockMutate = jest.fn();

jest.mock("../src/modules/auth/hooks/useAuth", () => ({
  ...jest.requireActual("../src/modules/auth/hooks/useAuth"),
  useLogin: () => ({ mutate: mockMutate, isPending: false, error: null }),
}));

jest.mock("../src/modules/marketplace/hooks/useMarketplace", () => ({
  ...jest.requireActual("../src/modules/marketplace/hooks/useMarketplace"),
  useRegisterCustomer: () => ({ mutate: mockMutate, isPending: false, error: null }),
}));

import { ThemeProvider } from "../src/theme";
import { SignInScreen } from "../src/modules/auth/screens/SignInScreen";
import { SignUpScreen } from "../src/modules/auth/screens/SignUpScreen";

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

/** Presses the screen's primary button by its visible title. */
async function press(tree: ReactTestRenderer.ReactTestRenderer, title: string) {
  const button = tree.root.findAllByType(AppButton).find((b) => b.props.title === title);
  if (!button) throw new Error(`no button titled "${title}"`);
  await ReactTestRenderer.act(async () => {
    button.props.onPress();
  });
}

beforeEach(() => {
  mockMutate.mockClear();
  mockGoBack.mockClear();
  mockCanGoBack.mockReturnValue(true);
});

describe("signing in", () => {
  it("closes the sheet when the session is real", async () => {
    const tree = await render(<SignInScreen />);

    // Fill both fields, or submit refuses before it ever reaches the mutation.
    const inputs = tree.root.findAllByType(require("react-native").TextInput);
    await ReactTestRenderer.act(async () => {
      inputs[0].props.onChangeText("ayesha@example.com");
      inputs[1].props.onChangeText("hunter2");
    });

    await press(tree, "Sign in");

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [, options] = mockMutate.mock.calls[0];
    expect(typeof options?.onSuccess).toBe("function");

    options.onSuccess();
    expect(mockGoBack).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("does not try to go back when there is nowhere to go", async () => {
    // The screen is also reachable as the only thing on a stack. Calling
    // mockGoBack there throws in some navigators and does nothing in others —
    // neither is a behaviour to rely on.
    mockCanGoBack.mockReturnValue(false);

    const tree = await render(<SignInScreen />);
    const inputs = tree.root.findAllByType(require("react-native").TextInput);
    await ReactTestRenderer.act(async () => {
      inputs[0].props.onChangeText("ayesha@example.com");
      inputs[1].props.onChangeText("hunter2");
    });

    await press(tree, "Sign in");
    mockMutate.mock.calls[0][1].onSuccess();

    expect(mockGoBack).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() => tree.unmount());
  });
});

describe("creating an account", () => {
  it("closes the sheet too — registering signs you straight in", async () => {
    const tree = await render(<SignUpScreen />);

    const inputs = tree.root.findAllByType(require("react-native").TextInput);
    await ReactTestRenderer.act(async () => {
      inputs.forEach((i) => i.props.onChangeText("Ayesha"));
    });

    await press(tree, "Create account");

    expect(mockMutate).toHaveBeenCalled();
    const options = mockMutate.mock.calls[0][1];
    expect(typeof options?.onSuccess).toBe("function");

    options.onSuccess();
    expect(mockGoBack).toHaveBeenCalled();

    await ReactTestRenderer.act(() => tree.unmount());
  });
});
