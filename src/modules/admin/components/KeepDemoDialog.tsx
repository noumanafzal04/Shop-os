import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiPost } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Button from "../../../components/ui/button/Button";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { refreshAfterADemoChanges } from "../hooks/useDemoShops";
import { suggestPassword } from "./suggestPassword";

/**
 * KEEP A DEMO FOR ITS OWNER — there and then.
 *
 * A demo could become a business in one way: its visitor pressed "Keep this
 * shop", filled a form in, and waited for an admin. That is right for a
 * stranger who found the landing page alone. It is the wrong way round for
 * the commonest sale there is — somebody from the platform sitting with the
 * shopkeeper, the demo open between them — and until now the admin side had
 * nothing to press.
 *
 * ── What it asks, and why it is those things ───────────────────────────
 *
 * The owner's SIGN-IN. A demo is entered by a token and nothing else: nobody
 * was ever told its password. A shop made real with that account is a shop
 * its owner cannot get back into tomorrow, so a name, an email and a password
 * are not optional here.
 *
 * The password is shown, not dotted. It is about to be said out loud to the
 * person it belongs to; an admin who cannot read it back cannot hand it over.
 * "Suggest one" makes one built for saying (see suggestPassword).
 *
 * The shop's NAME is optional. The owner is sent through the setup steps on
 * their first sign-in and is asked it there — but an admin who already knows
 * it should not leave a real shop on the list as "Mart Demo K7QP".
 *
 * NOT the plan. Giving a shop a plan is recording what it paid, which has its
 * own screen with its own arithmetic — the shop's page, where this goes next.
 */
export interface DemoToKeep {
  id: string;
  business_name: string;
}

export function KeepDemoDialog({
  demo,
  onClose,
  onKept,
}: {
  demo: DemoToKeep;
  onClose: () => void;
  /** It is a real shop now. Told the id so the caller can go to its page. */
  onKept: (id: string, message: string) => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState({ business_name: "", owner_name: "", owner_email: "", owner_phone: "", password: "" });
  const put = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const keep = useMutation({
    mutationFn: () =>
      apiPost<{ id: string }>(`/admin/demo-shops/${demo.id}/keep`, {
        owner_name: form.owner_name.trim(),
        owner_email: form.owner_email.trim(),
        owner_phone: form.owner_phone.trim() || undefined,
        password: form.password,
        business_name: form.business_name.trim() || undefined,
      }),
    onSuccess: ({ data, message }) => {
      refreshAfterADemoChanges(client);
      onKept(data.id, message ?? "It is a real shop now.");
    },
  });

  const ready =
    form.owner_name.trim() !== "" && /\S+@\S+\.\S+/.test(form.owner_email.trim()) && form.password.length >= 8;
  const refused = keep.error instanceof ApiError ? keep.error : null;
  const errorOf = (field: string) => refused?.errors[field]?.[0];

  return (
    <Modal isOpen onClose={onClose} className="max-w-lg">
      <ModalForm
        title="Make it a real shop"
        description={
          <>
            <strong className="font-semibold text-gray-700 dark:text-gray-200">{demo.business_name}</strong> stops being a
            demo and keeps everything in it — its items, its prices, the sales rung while trying it.
          </>
        }
        footer={
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!ready || keep.isPending} onClick={() => keep.mutate()}>
              {keep.isPending ? "Keeping it…" : "Make it a real shop"}
            </Button>
          </>
        }
      >
        <div className="space-y-4" data-testid="keep-demo">
          {refused && Object.keys(refused.errors).length === 0 && (
            <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
              {refused.message}
            </p>
          )}

          <div>
            <Label htmlFor="keep-shop-name">What the business is called</Label>
            <Input id="keep-shop-name" value={form.business_name} onChange={put("business_name")} placeholder={demo.business_name} />
            {errorOf("business_name")
              ? <p className="mt-1 text-theme-xs text-error-500">{errorOf("business_name")}</p>
              : <p className="mt-1 text-theme-xs text-gray-400">Leave it empty and the owner names it when they set the shop up.</p>}
          </div>

          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">The owner's sign-in</p>
            <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
              Nobody can sign in to a demo — it was opened without one. This is what they will use from now on.
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="keep-owner-name">Owner's name</Label>
                <Input id="keep-owner-name" value={form.owner_name} onChange={put("owner_name")} placeholder="Hamza Tariq" />
                {errorOf("owner_name") && <p className="mt-1 text-theme-xs text-error-500">{errorOf("owner_name")}</p>}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="keep-owner-email">Email</Label>
                  <Input id="keep-owner-email" type="email" value={form.owner_email} onChange={put("owner_email")} placeholder="hamza@example.com" />
                  {errorOf("owner_email") && <p className="mt-1 text-theme-xs text-error-500">{errorOf("owner_email")}</p>}
                </div>
                <div>
                  <Label htmlFor="keep-owner-phone">Phone (optional)</Label>
                  <Input id="keep-owner-phone" value={form.owner_phone} onChange={put("owner_phone")} placeholder="03001234567" />
                  {errorOf("owner_phone") && <p className="mt-1 text-theme-xs text-error-500">{errorOf("owner_phone")}</p>}
                </div>
              </div>
              <div>
                <Label htmlFor="keep-owner-password">Password</Label>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    {/* Readable on purpose — see the note at the top. */}
                    <Input
                      id="keep-owner-password"
                      type="text"
                      value={form.password}
                      onChange={put("password")}
                      placeholder="At least 8 characters"
                    />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, password: suggestPassword() }))}>
                    Suggest one
                  </Button>
                </div>
                {errorOf("password")
                  ? <p className="mt-1 text-theme-xs text-error-500">{errorOf("password")}</p>
                  : <p className="mt-1 text-theme-xs text-gray-400">Tell them this now. It is not shown again, and they can change it once they are in.</p>}
              </div>
            </div>
          </div>
        </div>
      </ModalForm>
    </Modal>
  );
}
