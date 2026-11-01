import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { EyeCloseIcon, EyeIcon } from "../../icons";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Button from "../ui/button/Button";
import Alert from "../ui/alert/Alert";
import { useLogin } from "../../modules/auth/hooks/useAuth";
import { ApiError } from "../../common/types/api";
import { useCoolDownState } from "../../common/api/coolDown";
import { PRODUCT } from "../../common/brand";

/**
 * SIGNING IN — redone (2026-11-01).
 *
 * What changed from the template it began as, and why:
 *
 *   "Keep me logged in" is gone. It was a tick nobody's sign-in ever read —
 *   the request carried the email and the password and nothing else — so it
 *   promised a choice the product did not offer.
 *
 *   The eye that shows the password is a real button, with a name, reachable
 *   by the keyboard. It was a <span> with an onClick.
 *
 *   The boxes say what they are to the browser (`username`,
 *   `current-password`), so a saved password is offered where it belongs.
 *
 *   Caps Lock is said under the password while it is on — the most common
 *   reason a right password is refused.
 *
 *   Somebody without an account is pointed at a walkthrough: shops are opened
 *   by the platform, not from this screen.
 */
export default function SignInForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  // Which box was left empty at the press — said under it, before anything is sent.
  const [missing, setMissing] = useState<"identifier" | "password" | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const login = useLogin();
  // A throttled sign-in (#AZ3): the server's wait is counted down where it is
  // said, and the button is held until it reaches 0 — another press inside it
  // only pushes the window further out.
  const wait = useCoolDownState(login.error);

  const errorMessage =
    wait.left > 0
      ? `Too many tries in a short time — wait ${wait.left} second${wait.left === 1 ? "" : "s"}, then try again.`
      : wait.over
        ? null
        : login.error instanceof ApiError
      ? login.error.firstFieldError() ?? login.error.message
      : login.error
        ? "Something went wrong. Please try again."
        : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Tap-guard: never double-submit while a request is in flight.
    if (login.isPending || wait.left > 0) return;
    // Said here, in the screen's words: an empty box went to the server and
    // came back as "The identifier field is required." (2026-11-01).
    const empty = !identifier.trim() ? "identifier" : !password ? "password" : null;
    setMissing(empty);
    if (empty) {
      document.getElementById(`signin-${empty}`)?.focus();
      return;
    }
    login.mutate({ identifier: identifier.trim(), password });
  };

  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsOn(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div className="w-full">
      <div>
        <div className="mb-8 text-center">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-gray-900 dark:text-white/90">
            Welcome back
          </h1>
          <p className="mt-2 text-theme-sm text-gray-500 dark:text-gray-400">
            Sign in with your email or phone number.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-5">
            <Alert variant="error" title="Sign in failed" message={errorMessage} />
          </div>
        )}
        {wait.over && (
          <div data-testid="sign-in-wait-over" className="mb-5">
            <Alert variant="info" title="Ready" message="The wait is over — you can sign in again now." />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label htmlFor="signin-identifier">Email or phone</Label>
            <Input
              id="signin-identifier"
              name="identifier"
              autoComplete="username"
              autoFocus
              placeholder="you@business.com"
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); if (missing === "identifier") setMissing(null); }}
              error={missing === "identifier"}
            />
            {missing === "identifier" && (
              <p role="alert" className="mt-1.5 text-theme-xs font-medium text-error-600 dark:text-error-400">Enter your email or phone number.</p>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <Label htmlFor="signin-password" className="mb-0">Password</Label>
              <Link
                to="/forgot-password"
                className="text-theme-sm font-medium text-brand-600 transition hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="signin-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (missing === "password") setMissing(null); }}
                onKeyDown={readCaps}
                error={missing === "password"}
                className="pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                aria-controls="signin-password"
                className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:text-gray-400 dark:hover:bg-white/5"
              >
                {showPassword ? <EyeIcon className="size-5 fill-current" /> : <EyeCloseIcon className="size-5 fill-current" />}
              </button>
            </div>
            {missing === "password" && (
              <p role="alert" className="mt-1.5 text-theme-xs font-medium text-error-600 dark:text-error-400">Enter your password.</p>
            )}
            {capsOn && (
              <p data-testid="caps-lock-on" role="status" className="mt-1.5 text-theme-xs font-medium text-warning-600 dark:text-warning-400">
                Caps Lock is on.
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" size="md" disabled={login.isPending || wait.left > 0}>
            {login.isPending ? "Signing in…" : wait.left > 0 ? `Wait ${wait.left}s` : "Sign in"}
          </Button>
        </form>

        <p className="mt-8 text-center text-theme-sm text-gray-500 dark:text-gray-400">
          New to {PRODUCT.name}?{" "}
          <a href="/#talk" className="font-medium text-brand-600 transition hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
            Ask for a walkthrough
          </a>
        </p>
      </div>
    </div>
  );
}
