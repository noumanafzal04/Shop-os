import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiPost } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import Button from "../../../components/ui/button/Button";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";

/**
 * "KEEP THIS SHOP" — the one form a demo ever shows.
 *
 * It asks for a contact and for the visitor's OWN sign-in. That second half is
 * not paperwork: until this moment a demo owner cannot sign in at all — the
 * account was opened with a throwaway address and a random password nobody was
 * ever told — so closing the tab lost them the shop before its own clock even
 * ran out. Filling this in means they can come back tonight, whatever the
 * admin later decides.
 *
 * It does NOT ask the shop's name, city or address. Those belong to the setup
 * wizard the app already has, and approval sends them through it. Asking the
 * same question in two forms is how the two answers start disagreeing.
 */
export default function KeepShopModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ contact_name: "", contact_email: "", contact_phone: "", password: "", note: "" });

  const ask = useMutation({
    mutationFn: () => apiPost("/shop/keep", form),
    onSuccess: ({ message }) => {
      toast.success(message ?? "Request sent — we will be in touch.");
      void queryClient.invalidateQueries({ queryKey: ["shop", "keep"] });
      onClose();
    },
    onError: (e) => {
      // The server's own words, including which field it objected to. An
      // "email already in use" that arrives as "something went wrong" is a
      // person retyping a correct address until they give up.
      toast.error(
        e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "The request could not be sent.",
      );
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const incomplete =
    !form.contact_name.trim() || !form.contact_email.trim() || form.password.length < 8;

  return (
    // `ModalForm`, and no padding on the Modal — the house form shell. It pins
    // the title and the buttons and scrolls only the middle, which is what
    // keeps a form's Save on screen on a laptop. Hand-rolling a header here
    // put the close button on top of the description and left the whole thing
    // a size and a rhythm apart from every other form in the app.
    <Modal isOpen={open} onClose={onClose} className="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask.mutate();
        }}
      >
        <ModalForm
          title="Keep this shop"
          description="Everything you have set up stays exactly as it is. We will be in touch to finish it off."
          footer={
            <>
              <Button type="button" size="sm" variant="outline" onClick={onClose}>Cancel</Button>
              {/* The shared Input takes no `required`, so the gate is on the
                  button — the better half anyway: a disabled Send beside
                  visibly empty boxes says what is missing, where a browser
                  bubble appears and vanishes. The server validates regardless
                  and its field errors come back through the toast. */}
              <Button type="submit" size="sm" disabled={ask.isPending || incomplete}>
                {ask.isPending ? "Sending…" : "Send request"}
              </Button>
            </>
          }
        >
          <div>
            <Label htmlFor="keep-name">Your name</Label>
            <Input id="keep-name" value={form.contact_name} onChange={set("contact_name")} placeholder="Bilal Ahmed" />
          </div>

          <div>
            <Label htmlFor="keep-email">Email</Label>
            <Input id="keep-email" type="email" value={form.contact_email} onChange={set("contact_email")} placeholder="you@business.com" />
            <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
              This becomes how you sign in.
            </p>
          </div>

          <div>
            <Label htmlFor="keep-password">Choose a password</Label>
            <Input id="keep-password" type="password" value={form.password} onChange={set("password")} placeholder="At least 8 characters" />
            <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
              {/* Said plainly, because it is the reason to fill this in even
                  before an answer comes back: until now this shop could not be
                  signed into at all. */}
              So you can come back to this shop from any device.
            </p>
          </div>

          <div>
            <Label htmlFor="keep-phone">Phone <span className="font-normal text-gray-400">(optional)</span></Label>
            <Input id="keep-phone" value={form.contact_phone} onChange={set("contact_phone")} placeholder="0300 1234567" />
          </div>

          <div>
            <Label htmlFor="keep-note">Anything we should know? <span className="font-normal text-gray-400">(optional)</span></Label>
            <Input id="keep-note" value={form.note} onChange={set("note")} placeholder="Two branches, opening next month" />
          </div>
        </ModalForm>
      </form>
    </Modal>
  );
}
