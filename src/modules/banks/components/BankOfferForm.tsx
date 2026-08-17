import { useState } from "react";

import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import type { BankCardOffer, BankOfferInput, BankOfferType, CardType } from "../services/banksService";

/**
 * One bank campaign.
 *
 * ── What the form leads with, and why it is not "how much" ──────────────
 *
 * How much is on the contract and nobody gets it wrong. What shops get wrong is
 * the two fields underneath it:
 *
 *   • a percentage with NO CAP. Ten per cent of a Rs 400,000 sale is a figure
 *     neither side pictured when they shook hands on "10% off", and the shop
 *     finds out when the bank rejects the claim. The warning is on the screen;
 *     the rule stays permissive, because uncapped deals are real and this file
 *     does not know what the shop signed.
 *   • an END DATE left blank. A campaign with no end runs until somebody
 *     remembers — and every day past the real end is a discount funded by the
 *     shop, not the bank.
 *
 * ── The window fields are the promotion ones, on purpose ────────────────
 *
 * Same four fields, same meanings, judged by the same code on the server
 * (`OfferWindow`). A shopkeeper who has set up a weekend promotion already
 * knows this form.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function BankOfferForm({
  offer,
  bankId,
  saving,
  onSave,
  onClose,
}: {
  offer: BankCardOffer | null;
  bankId: string;
  saving: boolean;
  onSave: (payload: BankOfferInput & { id?: string }) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(offer?.label ?? "");
  const [type, setType] = useState<BankOfferType>(offer?.type ?? "percent");
  const [value, setValue] = useState(String(offer?.value ?? ""));
  const [minSpend, setMinSpend] = useState(offer?.min_spend === null || offer?.min_spend === undefined ? "" : String(offer.min_spend));
  const [maxDiscount, setMaxDiscount] = useState(offer?.max_discount === null || offer?.max_discount === undefined ? "" : String(offer.max_discount));
  const [cardTypes, setCardTypes] = useState<CardType[]>(offer?.card_types ?? []);
  const [startsOn, setStartsOn] = useState(offer?.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(offer?.ends_on ?? "");
  const [days, setDays] = useState<number[]>(offer?.days_of_week ?? []);
  const [startTime, setStartTime] = useState(offer?.start_time?.slice(0, 5) ?? "");
  const [endTime, setEndTime] = useState(offer?.end_time?.slice(0, 5) ?? "");
  const [active, setActive] = useState(offer?.is_active ?? true);

  const toggle = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const uncapped = type === "percent" && maxDiscount.trim() === "";

  return (
    <Modal isOpen onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
        {offer ? "Edit offer" : "Add offer"}
      </h3>

      <div className="max-h-[65dvh] space-y-4 overflow-y-auto pr-1">
        <div>
          <Label>What is it called?</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ramadan 10%" />
          <p className="mt-1 text-theme-xs text-gray-400">
            The cashier sees this, and the claim is filed under it. "Offer 1" is a name somebody
            regrets in March.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Type</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as BankOfferType)}
              className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="percent">Percentage off</option>
              <option value="fixed">Fixed amount off</option>
            </select>
          </div>
          <div>
            <Label>{type === "percent" ? "Percent" : "Amount (Rs)"}</Label>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "percent" ? "10" : "500"} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Only on card amounts over (Rs)</Label>
            <Input value={minSpend} onChange={(e) => setMinSpend(e.target.value)} placeholder="Any" />
          </div>
          <div>
            <Label>Most it can take off (Rs)</Label>
            <Input value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)} placeholder="No cap" />
          </div>
        </div>

        {uncapped && (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
            No cap. On a Rs 400,000 sale this gives away Rs {(Number(value) || 0) * 4000}. If the
            bank's letter names a maximum, put it here — the claim will be measured against it.
          </p>
        )}

        <div>
          <Label>Which cards</Label>
          <div className="flex gap-2">
            {(["credit", "debit"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setCardTypes(toggle(cardTypes, t))}
                className={`rounded-lg border px-3 py-1.5 text-theme-xs capitalize ${
                  cardTypes.includes(t)
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="mt-1 text-theme-xs text-gray-400">
            Pick none for any card, which is the commonest deal. Picking one makes the cashier
            answer credit-or-debit at the till.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Starts</Label>
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </div>
          <div>
            <Label>Ends</Label>
            <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </div>
        </div>

        {endsOn === "" && (
          <p className="text-theme-xs text-gray-400">
            No end date means it runs until somebody switches it off. Every day past the real end is
            a discount you fund yourself.
          </p>
        )}

        <div>
          <Label>Only on these days</Label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(toggle(days, i))}
                className={`rounded-lg border px-2.5 py-1 text-theme-xs ${
                  days.includes(i)
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="mt-1 text-theme-xs text-gray-400">Pick none for every day.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>From</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <Label>Until</Label>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <p className="text-theme-xs text-gray-400">
          Both or neither. A window that crosses midnight — 10pm to 2am — works as you would expect.
        </p>

        <label className="flex items-center gap-2 text-theme-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
          />
          Running
        </label>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={saving || label.trim() === "" || Number(value) <= 0}
          onClick={() =>
            onSave({
              ...(offer ? { id: offer.id } : {}),
              bank_id: bankId,
              label: label.trim(),
              type,
              value: Number(value),
              min_spend: minSpend.trim() === "" ? null : Number(minSpend),
              max_discount: maxDiscount.trim() === "" ? null : Number(maxDiscount),
              card_types: cardTypes.length > 0 ? cardTypes : null,
              starts_on: startsOn || null,
              ends_on: endsOn || null,
              days_of_week: days.length > 0 ? days : null,
              // Both or neither — the server refuses half a window, and sending
              // one end would be a 422 the cashier never sees the cause of.
              start_time: startTime && endTime ? startTime : null,
              end_time: startTime && endTime ? endTime : null,
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
