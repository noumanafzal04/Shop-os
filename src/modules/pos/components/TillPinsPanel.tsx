import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useConfirm } from "../../../components/ui/confirm";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import { tillService, type TillUser } from "../services/tillService";

/**
 * Till PINs, managed where the owner already is.
 *
 * Setting your OWN PIN takes your password — that is what proves it's you.
 * Setting a cashier's takes owner authority alone, because an owner can
 * already reset their password; this is the same power, faster, and it matches
 * how a new cashier actually starts: handed a PIN on their first shift.
 */
export default function TillPinsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAuthStore((s) => s.user);
  const modal = useModal();

  const roster = useQuery({
    queryKey: ["pos", "till-users"],
    queryFn: async () => (await tillService.roster()).data,
  });

  const [target, setTarget] = useState<TillUser | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isSelf = target?.id === me?.id;

  const open = (user: TillUser) => {
    setTarget(user);
    setPin("");
    setConfirmPin("");
    setPassword("");
    setError(null);
    modal.openModal();
  };

  const save = async () => {
    if (!target || saving) return;
    if (pin !== confirmPin) { setError("The two PINs don't match."); return; }
    setSaving(true);
    setError(null);
    try {
      if (isSelf) await tillService.setOwnPin(password, pin);
      else await tillService.setStaffPin(target.id, pin);
      toast.success(`Till PIN set for ${target.name}`);
      qc.invalidateQueries({ queryKey: ["pos", "till-users"] });
      modal.closeModal();
    } catch (e) {
      setError(e instanceof ApiError ? e.firstFieldError() ?? e.message : "Couldn't save that PIN.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (user: TillUser) => {
    const ok = await confirm({
      title: `Remove ${user.name}'s till PIN?`,
      message: "They'll need a password to take the till until a new PIN is set.",
      confirmLabel: "Remove PIN",
      tone: "danger",
    });
    if (!ok) return;
    try {
      if (user.id === me?.id) await tillService.clearOwnPin();
      else await tillService.clearStaffPin(user.id);
      toast.success("Till PIN removed");
      qc.invalidateQueries({ queryKey: ["pos", "till-users"] });
    } catch {
      toast.error("Couldn't remove that PIN.");
    }
  };

  const users = roster.data ?? [];

  return (
    <div className="space-y-3">
      {roster.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ) : users.length === 0 ? (
        <p className="text-theme-sm text-gray-400">Nobody here can operate a till yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">{u.name}</span>
                  {u.id === me?.id && <Badge size="sm" color="light">You</Badge>}
                  {u.pin_locked && <Badge size="sm" color="error">PIN locked</Badge>}
                </div>
                <div className="text-theme-xs text-gray-400">
                  {u.role === "shop_owner" ? "Owner" : "Staff"} · {u.has_pin ? "PIN set" : "No PIN — password only"}
                </div>
              </div>
              <button type="button" onClick={() => open(u)} className="text-theme-xs font-medium text-brand-500 hover:text-brand-600">
                {u.has_pin ? "Change PIN" : "Set PIN"}
              </button>
              {u.has_pin && (
                <button type="button" onClick={() => remove(u)} className="text-theme-xs font-medium text-error-500 hover:text-error-600">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          {target?.has_pin ? "Change" : "Set"} till PIN
        </h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          {isSelf ? "Your own PIN — confirm with your password." : `For ${target?.name}.`}
        </p>

        <div className="space-y-4">
          {isSelf && (
            <div>
              <Label>Your password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          )}
          <div>
            <Label>New PIN <span className="font-normal text-gray-400">(4–6 digits)</span></Label>
            <Input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••"
            />
          </div>
          <div>
            <Label>Confirm PIN</Label>
            <Input
              type="password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••"
            />
          </div>
          {error && <p className="text-theme-sm text-error-500">{error}</p>}
          <p className="text-theme-xs text-gray-400">
            A till PIN only works at a till that's already signed in to this shop — it can never be used to log in.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving || pin.length < 4 || (isSelf && !password)}>
            {saving ? "Saving…" : "Save PIN"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
