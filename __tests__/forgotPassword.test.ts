import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";
import { resetReady } from "../src/modules/auth/resetPassword";

/**
 * FORGOT PASSWORD, IN THE APP. The sign-in screen used to say "reset it on the
 * website, then sign in here". Now: a 6-digit code to the email or phone, then
 * a new password (8+, typed twice) — the customer app's flow, same endpoints.
 */
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("forgot password", () => {
  it("is ready only with a 6-digit code and a matching 8+ password", () => {
    expect(resetReady({ code: "123456", password: "secret12", again: "secret12" })).toBe(true);
    expect(resetReady({ code: "12345", password: "secret12", again: "secret12" })).toBe(false);
    expect(resetReady({ code: "123456", password: "short", again: "short" })).toBe(false);
    expect(resetReady({ code: "123456", password: "secret12", again: "secret13" })).toBe(false);
  });

  it("is reachable from sign-in and asks the server's reset endpoints", () => {
    expect(read("src/modules/auth/screens/SignInScreen.tsx")).toMatch(/navigate\("ForgotPassword"/);
    expect(read("src/navigation/RootNavigator.tsx")).toMatch(/name="ForgotPassword" component=\{ForgotPasswordScreen\}/);
    const svc = read("src/modules/auth/services/authService.ts");
    expect(svc).toMatch(/purpose: "password_reset"/);
    expect(svc).toMatch(/"\/auth\/password\/reset"/);
  });
});
