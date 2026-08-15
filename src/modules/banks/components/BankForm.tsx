import { useState } from "react";

import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import type { Bank, BankInput } from "../services/banksService";

/**
 * The bank itself — a relationship the shop keeps for years.
 *
 * Deliberately tiny. Everything that changes every few months is on the OFFER,
 * not here; a form that mixed the two would have somebody re-typing "HBL" every
 * Ramadan or editing last year's campaign in place.
 */
export function BankForm({
  bank,
  saving,
  onSave,
  onClose,
}: {
  bank: Bank | null;
  saving: boolean;
  onSave: (payload: BankInput & { id?: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(bank?.name ?? "");
  const [shortCode, setShortCode] = useState(bank?.short_code ?? "");
  const [active, setActive] = useState(bank?.is_active ?? true);

  return (
    <Modal isOpen onClose={onClose} className="max-w-md p-6">
      <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
        {bank ? "Edit bank" : "Add bank"}
      </h3>

      <div className="space-y-4">
        <div>
          <Label>Bank name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="HBL" />
        </div>

        <div>
          <Label>Short code</Label>
          <Input
            value={shortCode}
            onChange={(e) => setShortCode(e.target.value)}
            placeholder="HBL"
          />
          <p className="mt-1 text-theme-xs text-gray-400">
            What fits on a receipt line — "Habib Bank Limited" does not, "HBL" does.
          </p>
        </div>

        <label className="flex items-center gap-2 text-theme-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
          />
          Offer this bank at the till
        </label>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={saving || name.trim() === ""}
          onClick={() =>
            onSave({
              ...(bank ? { id: bank.id } : {}),
              name: name.trim(),
              short_code: shortCode.trim() || null,
              is_active: active,
            })
          }
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
