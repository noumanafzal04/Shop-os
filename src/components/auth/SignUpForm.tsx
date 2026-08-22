import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { EyeCloseIcon, EyeIcon } from "../../icons";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Button from "../ui/button/Button";
import Alert from "../ui/alert/Alert";
import { ApiError } from "../../common/types/api";
import { useRegisterCustomer } from "../../modules/marketplace/hooks/useMarketplace";

/**
 * CUSTOMER registration (marketplace). Business accounts are created by the
 * platform admin — shop owners can't self-register here.
 */
export default function SignUpForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const register = useRegisterCustomer();

  const apiError = register.error instanceof ApiError ? register.error : null;
  const errorFor = (key: string) => apiError?.errors[key]?.[0];
  const generalError =
    apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (register.isPending) return;
    register.mutate({
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      password,
      password_confirmation: password,
    });
  };

  return (
    <div className="flex flex-col flex-1">
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="mb-2 font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
              Create your account
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Shop from local businesses in your city.
            </p>
          </div>

          {generalError && (
            <div className="mb-5">
              <Alert variant="error" title="Sign up failed" message={generalError} />
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="space-y-5">
              <div>
                <Label>
                  Full name <span className="text-error-500">*</span>
                </Label>
                <Input
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {errorFor("name") && (
                  <p className="mt-1 text-theme-xs text-error-500">{errorFor("name")}</p>
                )}
              </div>

              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {errorFor("email") && (
                  <p className="mt-1 text-theme-xs text-error-500">{errorFor("email")}</p>
                )}
              </div>

              <div>
                <Label>Phone {!email && <span className="text-error-500">*</span>}</Label>
                <Input
                  placeholder="+92…"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                {errorFor("phone") && (
                  <p className="mt-1 text-theme-xs text-error-500">{errorFor("phone")}</p>
                )}
                <p className="mt-1 text-theme-xs text-gray-400">
                  Email or phone — at least one is required.
                </p>
              </div>

              <div>
                <Label>
                  Password <span className="text-error-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 8 characters"
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
                {errorFor("password") && (
                  <p className="mt-1 text-theme-xs text-error-500">{errorFor("password")}</p>
                )}
              </div>

              <Button type="submit"
                className="w-full"
                size="sm"
                disabled={register.isPending || !name.trim() || !password || (!email.trim() && !phone.trim())}
              >
                {register.isPending ? "Creating account…" : "Create account"}
              </Button>
            </div>
          </form>

          <div className="mt-5">
            <p className="text-sm font-normal text-center text-gray-700 dark:text-gray-400 sm:text-start">
              Already have an account?{" "}
              <Link to="/signin" className="text-brand-500 hover:text-brand-600 dark:text-brand-400">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
