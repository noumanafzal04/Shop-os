import { useEffect, useState } from "react";

import Button from "../../../components/ui/button/Button";
import { Modal, ModalForm } from "../../../components/ui/modal";
import type { Product } from "../../catalog/types";
import { sizesOf } from "../../pos/availability";
import { useMoney } from "../../shop/hooks/useShop";
import { type Choice, choiceIsComplete, groupKey, lineOf, toggled, unitPriceOf, whatIsMissing, type OrderLine } from "../takeOrder";

/**
 * WHICH SIZE, AND WHAT WITH IT — asked before a dish goes on a phone order.
 *
 * The till asks and the table asks. The Take-order page did not: it had one
 * button per dish and put the dish on the order as it stood — no size, no
 * answers — so a karahi was taken at the Half's price whichever the caller
 * wanted, and a dish with a question was refused when the order was sent, on a
 * page with nowhere to answer it.
 *
 * One sheet: the sizes first, each with its own price, then each question.
 * "Add to order" stays shut until there is a size and every question that must
 * be answered has been — and says which is missing.
 */
export function ChooseHow({ product, onClose, onAdd }: {
  product: Product | null;
  onClose: () => void;
  onAdd: (line: OrderLine) => void;
}) {
  const money = useMoney();
  const [choice, setChoice] = useState<Choice>({ variantId: null, byGroup: {} });

  // A new dish is asked about from the start: the last one's answers are not its answers.
  useEffect(() => {
    if (product === null) return;
    const only = sizesOf(product);
    setChoice({ variantId: only.length === 1 ? only[0].id : null, byGroup: {} });
  }, [product]);

  if (product === null) return <Modal isOpen={false} onClose={onClose}><span /></Modal>;

  const sizes = sizesOf(product);
  const groups = (product.modifier_groups ?? []).filter((g) => (g.options ?? []).length > 0);
  const line = lineOf(product, choice);
  const complete = choiceIsComplete(product, choice);
  const missing = whatIsMissing(product, choice);

  return (
    <Modal isOpen onClose={onClose} className="max-w-md">
      <ModalForm
        title={product.name}
        description={sizes.length > 0 ? "Which size, and what with it?" : "What with it?"}
        footer={
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!complete} onClick={() => { onAdd(line); onClose(); }}>
              Add to order · {money(unitPriceOf(product, line.variant, line.options))}
            </Button>
          </>
        }
      >
        {sizes.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-theme-sm font-medium text-gray-700 dark:text-gray-300">
              Size <span className="text-error-500">*</span>
            </legend>
            <div role="radiogroup" aria-label="Size" className="grid grid-cols-2 gap-2">
              {sizes.map((v) => {
                const off = (v.sold_out_at ?? null) !== null;
                const on = choice.variantId === v.id;

                return (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={off}
                    onClick={() => setChoice((c) => ({ ...c, variantId: v.id }))}
                    className={`flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      on
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                        : "border-gray-200 hover:border-brand-300 dark:border-gray-700"
                    }`}
                  >
                    <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{v.name}</span>
                    <span className="text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {off ? "off today" : money(Number(v.price))}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {groups.map((g) => {
          const key = groupKey(g);
          const chosen = choice.byGroup[key] ?? [];
          const one = g.max_select === 1;

          return (
            <fieldset key={key}>
              <legend className="mb-2 flex w-full items-baseline justify-between gap-2 text-theme-sm font-medium text-gray-700 dark:text-gray-300">
                <span>
                  {g.name} {g.min_select > 0 && <span className="text-error-500">*</span>}
                </span>
                <span className="text-theme-xs font-normal text-gray-400">
                  {g.min_select > 0
                    ? one ? "choose one" : `choose ${g.min_select}${g.max_select > g.min_select ? ` to ${g.max_select}` : ""}`
                    : g.max_select > 0 ? `up to ${g.max_select}, if wanted` : "if wanted"}
                </span>
              </legend>
              <div role="group" aria-label={g.name} className="flex flex-wrap gap-2">
                {(g.options ?? []).map((o) => {
                  const on = o.id !== undefined && chosen.includes(o.id);
                  const adds = Number(o.price_delta);

                  return (
                    <button
                      key={o.id ?? o.name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => o.id !== undefined && setChoice((c) => ({ ...c, byGroup: { ...c.byGroup, [key]: toggled(g, chosen, o.id!) } }))}
                      className={`min-h-11 rounded-xl border px-3 text-theme-sm transition ${
                        on
                          ? "border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                          : "border-gray-200 text-gray-700 hover:border-brand-300 dark:border-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {o.name}
                      {adds !== 0 && <span className="ml-1.5 tabular-nums text-gray-400">+{money(adds)}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        {/* What is still missing, said — a shut button with no reason is a puzzle. */}
        {missing !== null && (
          <p role="status" className="text-theme-xs text-gray-500 dark:text-gray-400">{missing}</p>
        )}
      </ModalForm>
    </Modal>
  );
}
