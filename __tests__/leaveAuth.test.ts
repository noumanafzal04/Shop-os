import { authScreensOnTop, leaveAuth, switchAuth } from "../src/modules/auth/leaveAuth";

/**
 * SIGNED IN → OUT OF EVERY SIGN-IN SCREEN, NOT JUST THE TOP ONE.
 *
 * Sign-up → "Sign in" → signed in used to go back one screen and leave a
 * signed-in customer looking at "Create your account".
 */
describe("leaving the sign-in screens", () => {
  const nav = (names: string[]) => ({
    canGoBack: () => names.length > 1,
    goBack: jest.fn(),
    pop: jest.fn(),
    getState: () => ({ routes: names.map((name) => ({ name })) }),
  });

  it("counts only the auth screens on top", () => {
    expect(authScreensOnTop([{ name: "Tabs" }, { name: "Checkout" }, { name: "SignUp" }, { name: "SignIn" }])).toBe(2);
    expect(authScreensOnTop([{ name: "SignIn" }, { name: "Tabs" }])).toBe(0);
  });

  it("pops sign-up and sign-in together, and leaves the checkout under them", () => {
    const n = nav(["Tabs", "Checkout", "SignUp", "SignIn"]);
    leaveAuth(n);
    expect(n.pop).toHaveBeenCalledWith(2);
    expect(n.goBack).not.toHaveBeenCalled();
  });

  it("goes back once when sign-in is the only one", () => {
    const n = nav(["Tabs", "SignIn"]);
    leaveAuth(n);
    expect(n.goBack).toHaveBeenCalledTimes(1);
    expect(n.pop).not.toHaveBeenCalled();
  });

  it("does nothing where there is nowhere to go back to", () => {
    const n = nav(["SignIn"]);
    leaveAuth(n);
    expect(n.goBack).not.toHaveBeenCalled();
    expect(n.pop).not.toHaveBeenCalled();
  });
});

describe("moving between sign-in and sign-up", () => {
  it("swaps the screen rather than stacking another", () => {
    const n = { replace: jest.fn(), navigate: jest.fn() };
    switchAuth(n, "SignUp");
    expect(n.replace).toHaveBeenCalledWith("SignUp");
    expect(n.navigate).not.toHaveBeenCalled();
  });
});
