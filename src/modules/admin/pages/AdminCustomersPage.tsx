import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { apiPost } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Alert from "../../../components/ui/alert/Alert";
import { useToast } from "../../../components/ui/toast";

/**
 * A SHOPPER'S ACCOUNT, made by staff.
 *
 * ── Why this screen exists ──────────────────────────────────────────────
 *
 * A customer account could only ever be made by the customer, through the app
 * on their own phone. That is the right default and it was the only door:
 * somebody ringing the platform to place an order, a regular who does not use
 * apps, a tester who needs an account before the APK is installed — every one
 * of those ended in "ask them to download it first", which is not an answer.
 *
 * ── Why it is a page with ONE form on it ────────────────────────────────
 *
 * There is no list here, and no edit or delete, because none was asked for and
 * a platform screen that can search and read every customer's phone number is
 * a different thing needing a different argument. A page whose whole job is one
 * deliberate action is a legitimate page; hiding the only door inside an
 * unrelated screen is what the alternative looked like.
 */
export default function AdminCustomersPage() {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [made, setMade] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ id: string; name: string }>("/admin/customers", {
        name: form.name.trim(),
        // Empty strings are not "no value" to a validator — `email` would fail
        // its format rule rather than being treated as absent, and the message
        // would be about an address nobody typed.
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        password: form.password,
      }),
    onSuccess: ({ data, message }) => {
      toast.success(message ?? "Account created.");
      setMade(data.name);
      setForm({ name: "", phone: "", email: "", password: "" });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "That did not go through."),
  });

  // Login takes an `identifier` that is "email or phone". An account with
  // neither is a row that looks fine and can never be opened — the server
  // refuses it, and so does the button, so nobody meets that by surprise.
  const canSubmit =
    form.name.trim() !== "" &&
    (form.phone.trim() !== "" || form.email.trim() !== "") &&
    form.password.length >= 8;

  return (
    <>
      <PageMeta title="Customers | CartZe" description="Create a customer account" />

      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Customers</h1>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          Make an account for somebody who cannot make their own — a caller placing an order,
          a regular who does not use apps. They sign in on the app with what you set here.
        </p>
      </div>

      {made && (
        <div className="mb-4">
          <Alert
            variant="success"
            title={`${made} can sign in now`}
            message="Give them the number and password you typed. They can change the password in the app."
          />
        </div>
      )}

      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="space-y-4">
          <div>
            <Label htmlFor="cust-name">Name</Label>
            <Input
              id="cust-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Farhan Ali"
            />
          </div>
          <div>
            <Label htmlFor="cust-phone">Phone</Label>
            <Input
              id="cust-phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="03001234567"
            />
          </div>
          <div>
            <Label htmlFor="cust-email">Email (optional)</Label>
            <Input
              id="cust-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="farhan@example.com"
            />
            <p className="mt-1.5 text-theme-xs text-gray-400">
              A phone or an email — they sign in with either, so one of the two is required.
            </p>
          </div>
          <div>
            <Label htmlFor="cust-password">Password</Label>
            <Input
              id="cust-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="At least 8 characters"
            />
          </div>
          <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create account"}
          </Button>
        </div>
      </div>
    </>
  );
}
