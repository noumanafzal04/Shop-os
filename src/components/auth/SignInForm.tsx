import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { EyeCloseIcon, EyeIcon } from "../../icons";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Checkbox from "../form/input/Checkbox";
import Button from "../ui/button/Button";
import Alert from "../ui/alert/Alert";
import { useLogin } from "../../modules/auth/hooks/useAuth";
import { ApiError } from "../../common/types/api";
import { useCoolDownState } from "../../common/api/coolDown";

export default function SignInForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
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
    login.mutate({ identifier: identifier.trim(), password });
  };

  return (
    <div className="flex flex-col flex-1">
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="mb-2 font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
              Sign In
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Enter your email or phone and password to sign in.
            </p>
          </div>
          <div>
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
            <form onSubmit={handleSubmit}>
              <div className="space-y-6">
                <div>
                  <Label>
                    Email or Phone <span className="text-error-500">*</span>
                  </Label>
                  <Input
                    placeholder="you@business.com"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                </div>
                <div>
                  <Label>
                    Password <span className="text-error-500">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <span
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute z-30 -translate-y-1/2 cursor-pointer right-4 top-1/2"
                    >
                      {showPassword ? (
                        <EyeIcon className="fill-gray-500 dark:fill-gray-400 size-5" />
                      ) : (
                        <EyeCloseIcon className="fill-gray-500 dark:fill-gray-400 size-5" />
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Checkbox checked={keepLoggedIn} onChange={setKeepLoggedIn} />
                    <span className="block font-normal text-gray-700 text-theme-sm dark:text-gray-400">
                      Keep me logged in
                    </span>
                  </div>
                  <Link
                    to="/forgot-password"
                    className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div>
                  <Button type="submit" className="w-full" size="sm" disabled={login.isPending || wait.left > 0}>
                    {login.isPending ? "Signing in…" : wait.left > 0 ? `Wait ${wait.left}s` : "Sign in"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
