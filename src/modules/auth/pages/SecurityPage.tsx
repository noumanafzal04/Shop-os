import { useState, type FormEvent } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useChangePassword } from "../hooks/useAuth";
import { useAuthStore } from "../../../stores/authStore";

/**
 * Change your own password.
 *
 * The endpoint has existed since the first week and the panel's service method
 * has existed nearly as long — nothing ever called it. So nobody on this
 * platform could change their own password: not the shop owner, not a cashier
 * whose PIN was seen, and not the super admin, whose seeded password is
 * published in a public repo and is now a hard failure in
 * `php artisan shopos:readiness`.
 *
 * One screen for every role. There is nothing role-specific about it, and a
 * second copy on the admin side is a second copy to forget to fix.
 */
export default function SecurityPage() {
  const user = useAuthStore((s) => s.user);
  const changePassword = useChangePassword();
  const toast = useToast();

  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const apiError = changePassword.error instanceof ApiError ? changePassword.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];
  // CURRENT_PASSWORD_MISMATCH is a domain error, not a field error, so it
  // arrives with an empty `errors` map and would otherwise vanish.
  const generalError = apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const mismatch = form.confirm.length > 0 && form.next !== form.confirm;
  const tooShort = form.next.length > 0 && form.next.length < 8;
  const sameAsOld = form.next.length > 0 && form.next === form.current;

  const canSubmit =
    !changePassword.isPending &&
    form.current.length > 0 &&
    form.next.length >= 8 &&
    form.next === form.confirm &&
    !sameAsOld;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    changePassword.mutate(
      {
        current_password: form.current,
        password: form.next,
        password_confirmation: form.confirm,
      },
      {
        onSuccess: () => {
          toast.success("Password changed. Your other devices have been signed out.");
          setForm({ current: "", next: "", confirm: "" });
        },
      },
    );
  };

  return (
    <>
      <PageMeta title="Security | CartZe" description="Change your password" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Security</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Signed in as {user?.name}
          {user?.email || user?.phone ? ` (${user.email ?? user.phone})` : ""}
        </p>
      </div>

      <form onSubmit={submit} className="max-w-md">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">Change password</h3>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            This device stays signed in. Every other one is signed out.
          </p>

          <div className="mt-5 space-y-4">
            <div>
              <Label>
                Current password <span className="text-error-500">*</span>
              </Label>
              <Input
                type="password"
                value={form.current}
                autoComplete="current-password"
                onChange={(e) => set("current", e.target.value)}
              />
              {errorFor("current_password") && (
                <p className="mt-1 text-theme-xs text-error-500">{errorFor("current_password")}</p>
              )}
            </div>

            <div>
              <Label>
                New password <span className="text-error-500">*</span>
              </Label>
              <Input
                type="password"
                value={form.next}
                autoComplete="new-password"
                onChange={(e) => set("next", e.target.value)}
              />
              {tooShort && <p className="mt-1 text-theme-xs text-error-500">At least 8 characters.</p>}
              {sameAsOld && (
                <p className="mt-1 text-theme-xs text-error-500">
                  That is the password you already have.
                </p>
              )}
              {errorFor("password") && (
                <p className="mt-1 text-theme-xs text-error-500">{errorFor("password")}</p>
              )}
            </div>

            <div>
              <Label>
                Type it again <span className="text-error-500">*</span>
              </Label>
              <Input
                type="password"
                value={form.confirm}
                autoComplete="new-password"
                onChange={(e) => set("confirm", e.target.value)}
              />
              {mismatch && <p className="mt-1 text-theme-xs text-error-500">These do not match.</p>}
            </div>

            {generalError && (
              <p className="rounded-lg bg-error-50 p-3 text-theme-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
                {generalError}
              </p>
            )}

            <Button type="submit" size="sm" disabled={!canSubmit}>
              {changePassword.isPending ? "Changing…" : "Change password"}
            </Button>
          </div>
        </section>
      </form>
    </>
  );
}
