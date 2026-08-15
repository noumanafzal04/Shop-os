import { useEffect, useState } from "react";

import { useBankQuote, useLiveBanks } from "../hooks/useBanks";
import type { CardType } from "../services/banksService";

/**
 * A bank funding part of its own card's transaction, at the tender screen.
 *
 * ── Everything here is optional, on purpose ─────────────────────────────
 *
 * A cashier who does not care never touches it, and the tender behaves exactly
 * as it did before this existed. Most shops have no bank deals at all and never
 * see the row: `useLiveBanks` returns nothing and it renders nothing.
 *
 * ── The figure is asked for, never worked out ───────────────────────────
 *
 * This shows what the SERVER says comes off. It does not multiply anything. The
 * sale then recomputes the same number from the same offer through the same
 * service — so a cashier who sits here until a happy hour ends gets the honest
 * figure at Complete rather than the one they were shown, and nothing the
 * browser could be persuaded to send can change what the shop charges.
 *
 * ── The card field says "last 4" because that is all it may ever hold ───
 *
 * A full card number puts the shop and this platform inside PCI DSS, which is
 * an audit regime rather than a setting. The label is the control: a box
 * labelled "card number" has sixteen digits typed into it by lunchtime on day
 * one. The server refuses more than four outright rather than trimming, because
 * a number accepted into the request is a number in the logs.
 */

interface Props {
  /** The share of the bill going on a card, BEFORE the bank's help. */
  cardAmount: number;
  bankId: string | null;
  onBank: (bankId: string | null) => void;
  cardLast4: string;
  onLast4: (last4: string) => void;
  cardType: CardType | null;
  onCardType: (type: CardType | null) => void;
  /** What the server quoted, lifted so the totals line can show it too. */
  onQuote: (discount: number) => void;
}

const money = (n: number) => `Rs ${n.toLocaleString()}`;

export function BankOfferRow({
  cardAmount,
  bankId,
  onBank,
  cardLast4,
  onLast4,
  cardType,
  onCardType,
  onQuote,
}: Props) {
  const banks = useLiveBanks(cardAmount > 0);
  const quote = useBankQuote();
  const [shown, setShown] = useState<{ label: string; discount: number } | null>(null);

  const rows = banks.data ?? [];
  // Does any live offer care which kind of card it is? Asking every cashier
  // credit-or-debit when no deal distinguishes them is a question for nothing.
  const typeMatters = rows.some((b) => b.offers.some((o) => (o.card_types ?? []).length > 0));

  useEffect(() => {
    if (bankId === null || cardAmount <= 0) {
      setShown(null);
      onQuote(0);

      return;
    }

    let live = true;
    quote
      .mutateAsync({ bank_id: bankId, card_amount: cardAmount, card_type: cardType })
      .then(({ data }) => {
        if (!live) return;
        setShown(data.discount > 0 ? { label: data.label ?? "Bank offer", discount: data.discount } : null);
        onQuote(data.discount);
      })
      .catch(() => {
        // A quote that will not load must never block a sale. The row goes
        // quiet and the customer pays full price, which is the honest answer
        // when nobody can say otherwise.
        if (!live) return;
        setShown(null);
        onQuote(0);
      });

    return () => {
      live = false;
    };
    // `quote` and `onQuote` are stable enough for this to be the real dependency
    // set; re-running on every render would fire a request per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId, cardAmount, cardType]);

  // Nothing running today, or nothing on a card. Most shops, most of the time.
  if (rows.length === 0 || cardAmount <= 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-theme-sm font-medium text-gray-500 dark:text-gray-400">
          Bank offer
        </span>
        <span className="text-theme-xs text-gray-400">Optional</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={bankId ?? ""}
          onChange={(e) => onBank(e.target.value || null)}
          aria-label="Bank"
          className="rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">No bank</option>
          {rows.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        {/* A plain input rather than the shared one, for two reasons that both
            matter at a counter: `inputMode` brings up the number pad on a
            tablet, and `maxLength` is a second fence behind the slice below.
            A cashier hunting for digits on a text keyboard is friction the
            shared component cannot express. */}
        <input
          type="text"
          placeholder="Last 4 digits"
          aria-label="Last 4 digits of the card"
          inputMode="numeric"
          maxLength={4}
          value={cardLast4}
          // Digits only, four at most — so the field cannot be made to hold a
          // card number even by pasting one in.
          onChange={(e) => onLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className="rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {typeMatters && bankId !== null && (
        <div className="mt-2 flex gap-2">
          {([null, "credit", "debit"] as const).map((t) => (
            <button
              key={t ?? "any"}
              type="button"
              onClick={() => onCardType(t)}
              className={`rounded-lg border px-3 py-1.5 text-theme-xs ${
                cardType === t
                  ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                  : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300"
              }`}
            >
              {t === null ? "Not sure" : t === "credit" ? "Credit" : "Debit"}
            </button>
          ))}
        </div>
      )}

      {shown !== null && (
        <p className="mt-2 text-theme-sm font-medium text-success-600 dark:text-success-500">
          {shown.label} — {money(shown.discount)} off
        </p>
      )}

      {bankId !== null && shown === null && !quote.isPending && (
        // Said out loud, because silence after picking a bank reads as broken.
        <p className="mt-2 text-theme-xs text-gray-400">
          Nothing applies to this sale.
        </p>
      )}
    </div>
  );
}
