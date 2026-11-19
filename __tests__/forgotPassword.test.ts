import { PROJECT_ROOT, fs, path } from "./support/node";
import { resetReady } from "../src/modules/auth/resetPassword";

/**
 * "Login and signup b" — the log-in form had no way back for a forgotten
 * password, though the server has had one all along.
 */
const read = (p: string) => fs.readFileSync(path.join(PROJECT_ROOT, p), "utf8");

describe("forgot password", () => {
  it("is ready only with a 6-digit code and a matching password of 8 or more", () => {
    expect(resetReady({ code: "123456", password: "secret12", again: "secret12" })).toBe(true);
    expect(resetReady({ code: " 123456 ", password: "secret12", again: "secret12" })).toBe(true);
    expect(resetReady({ code: "12345", password: "secret12", again: "secret12" })).toBe(false);
    expect(resetReady({ code: "1234567", password: "secret12", again: "secret12" })).toBe(false);
    expect(resetReady({ code: "12a456", password: "secret12", again: "secret12" })).toBe(false);
    expect(resetReady({ code: "123456", password: "short", again: "short" })).toBe(false);
    expect(resetReady({ code: "123456", password: "secret12", again: "secret13" })).toBe(false);
    expect(resetReady({ code: "", password: "", again: "" })).toBe(false);
  });

  it("is reachable from the log-in form and registered as a screen", () => {
    expect(read("src/modules/auth/screens/SignInScreen.tsx")).toMatch(/navigation\.navigate\("ForgotPassword"/);
    expect(read("src/navigation/RootNavigator.tsx")).toMatch(
      /name="ForgotPassword" component=\{ForgotPasswordScreen\}/,
    );
  });

  it("asks the server's own two endpoints, for the reset purpose", () => {
    const src = read("src/modules/auth/screens/ForgotPasswordScreen.tsx");
    expect(src).toMatch(/requestOtp\(identifier\.trim\(\), "password_reset"\)/);
    expect(src).toMatch(/authService\.resetPassword\(/);
    expect(src).toMatch(/password_confirmation: again/);
  });

  it("never says whether an account exists", () => {
    const src = read("src/modules/auth/screens/ForgotPasswordScreen.tsx");
    expect(src).toMatch(/If an account uses/);
    expect(src).not.toMatch(/No account|not found|does not exist/i);
  });

  it("drops the old code when the address changes", () => {
    const src = read("src/modules/auth/screens/ForgotPasswordScreen.tsx");
    expect(src).toMatch(/if \(sent\) \{\s*setSent\(false\);\s*setCode\(""\);/);
  });

  it("the log-in button says the tab's word", () => {
    const src = read("src/modules/auth/screens/SignInScreen.tsx");
    expect(src).toMatch(/title="Log in"/);
    expect(src).not.toMatch(/title="Sign in"/);
  });
});
