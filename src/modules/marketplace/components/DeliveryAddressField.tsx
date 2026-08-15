import { useEffect, useMemo, useState } from "react";

import Input from "../../../components/form/input/InputField";
import { useToast } from "../../../components/ui/toast";
import { useAddresses, useDeleteAddress, useSaveAddress } from "../hooks/useMarketplace";

/**
 * Where the order is going — picked, not retyped.
 *
 * ── Why this exists ────────────────────────────────────────────────────
 *
 * The saved-address endpoints have been on the server since the marketplace
 * shipped: list, add, edit, remove, with one default kept correct atomically.
 * Nothing ever called them. The checkout had a bare text box, so a customer
 * ordering from the same shop every week typed the same address every week —
 * and a mistyped one is a rider at the wrong gate, which costs the shop the
 * delivery and the customer the order.
 *
 * Built, wired, and orphaned by one missing link. It is the third time that
 * exact shape has turned up in this codebase.
 *
 * ── What it does NOT do ────────────────────────────────────────────────
 *
 * No map, no pin, no autocomplete. A Pakistani address is a sentence — "House
 * 42, Street 7, Phase 4, DHA, near the Total pump" — and a form with fields for
 * house/street/area would refuse half of them. One box, saved and reused, does
 * the whole job.
 *
 * ── Falling back is not an error state ─────────────────────────────────
 *
 * A signed-out visitor, a failed fetch, a customer with nothing saved: all of
 * them get the plain box they had before, with nothing missing from their point
 * of view. Losing an address book must never cost somebody an order.
 */

interface Props {
  value: string;
  onChange: (address: string) => void;
  /** Saved addresses belong to a signed-in customer; nobody else has any. */
  enabled: boolean;
}

export function DeliveryAddressField({ value, onChange, enabled }: Props) {
  const addresses = useAddresses(enabled);
  const save = useSaveAddress();
  const remove = useDeleteAddress();
  const toast = useToast();

  // Memoised because it is a useEffect dependency below: `data ?? []` mints a
  // new array on every render, which would re-run the prefill on every render.
  const saved = useMemo(() => addresses.data ?? [], [addresses.data]);

  /** Typing a new one, rather than picking. Forced on when there is nothing to pick. */
  const [entering, setEntering] = useState(false);
  const [saveIt, setSaveIt] = useState(true);
  const [prefilled, setPrefilled] = useState(false);

  // Fill in the default ONCE, and only into an empty box. Re-running it would
  // overwrite an address somebody was halfway through typing every time the
  // list refetched — the exact bug a saved-address feature is supposed to fix.
  useEffect(() => {
    if (prefilled || value !== "" || saved.length === 0) return;
    onChange((saved.find((a) => a.is_default) ?? saved[0]).address);
    setPrefilled(true);
  }, [saved, value, prefilled, onChange]);

  // Removing an address is destructive and silent otherwise — the row simply
  // vanishes, which reads as a glitch rather than as something you did.
  const forget = (id: string) =>
    remove.mutate(id, {
      onSuccess: () => toast.success("Address removed"),
      onError: () => toast.error("That address couldn't be removed. Try again."),
    });

  const picking = enabled && saved.length > 0 && !entering;

  return (
    <div className="space-y-2">
      {picking ? (
        <>
          {saved.map((a) => {
            const chosen = a.address === value;

            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onChange(a.address)}
                aria-pressed={chosen}
                className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                  chosen
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                    : "border-gray-300 dark:border-gray-700"
                }`}
              >
                <span className="min-w-0 flex-1">
                  {a.label && (
                    <span className="block text-theme-xs font-semibold text-gray-700 dark:text-gray-200">
                      {a.label}
                      {a.is_default && <span className="ml-1 font-normal text-gray-400">· default</span>}
                    </span>
                  )}
                  <span className="block truncate text-gray-600 dark:text-gray-300">{a.address}</span>
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Remove ${a.label ?? a.address}`}
                  onClick={(e) => {
                    // Inside a button, so the click has to be stopped or
                    // removing an address also selects it on the way out.
                    e.stopPropagation();
                    forget(a.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.stopPropagation();
                    forget(a.id);
                  }}
                  className="shrink-0 px-1 text-theme-xs text-gray-400 hover:text-error-500"
                >
                  Remove
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setEntering(true);
              onChange("");
            }}
            className="text-theme-xs text-brand-500 hover:underline"
          >
            Deliver somewhere else
          </button>
        </>
      ) : (
        <>
          <Input
            placeholder="Delivery address"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />

          {enabled && (
            <label className="flex items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
              <input
                type="checkbox"
                checked={saveIt}
                onChange={(e) => setSaveIt(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-700"
              />
              Save this address for next time
            </label>
          )}

          {enabled && saveIt && value.trim() !== "" && (
            <button
              type="button"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(
                  { address: value.trim(), is_default: saved.length === 0 },
                  {
                    onSuccess: () => {
                      setEntering(false);
                      toast.success("Address saved — it will be here next time");
                    },
                    onError: () =>
                      toast.error("That address couldn't be saved. You can still order with it."),
                  },
                )
              }
              className="text-theme-xs text-brand-500 hover:underline disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save address"}
            </button>
          )}

          {saved.length > 0 && entering && (
            <button
              type="button"
              onClick={() => setEntering(false)}
              className="block text-theme-xs text-gray-400 hover:underline"
            >
              Use a saved address instead
            </button>
          )}
        </>
      )}
    </div>
  );
}
