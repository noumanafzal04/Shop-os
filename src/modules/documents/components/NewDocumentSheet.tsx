import { useState } from "react";

import { deniedReason } from "../../../common/api/denied";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { NoAccess } from "../../../common/ui/NoAccess";
import Input from "../../../components/form/input/InputField";
import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import { useProducts } from "../../catalog/hooks/useCatalog";
import { changed, offersOf, taken, type Replacement } from "../../sales/replacements";
import { useMoney } from "../../shop/hooks/useShop";
import type { DocumentKind } from "../services/documentService";
import ParkAsDocumentModal from "./ParkAsDocumentModal";
import StartInstallmentModal from "./StartInstallmentModal";
import type { InstallmentPlan } from "../services/installmentService";

/** What the sheet starts: one of the two documents, or goods on installments (F1). */
export type Starting = DocumentKind | "installments";

/**
 * A QUOTATION — OR GOODS HELD ON ADVANCE — STARTED FROM THEIR OWN SCREEN.
 *
 * Both could only be made at the till: fill a cart, press "Park as quote".
 * The shopkeeper on Quotations & advances, with a customer on the phone
 * asking for a price, had to leave the screen to give one (the user,
 * 2026-10-15: "quotes py b add quote ka button dy dena").
 *
 * The items are picked here, the way the exchange sheet picks a replacement
 * (each size its own row, what is left beside it); then the same form the till
 * uses takes the customer, the date and any advance. The figure shown here is
 * the shelf price added up — the server prices the document when it is saved.
 */
export default function NewDocumentSheet({
  isOpen,
  onClose,
  startAs,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  startAs: Starting;
  /** Which kind was saved — the list turns to it, so the new one is in view. */
  onSaved: (kind: Starting, plan?: InstallmentPlan) => void;
}) {
  const installments = startAs === "installments";
  const money = useMoney();
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Replacement[]>([]);
  const [saving, setSaving] = useState(false);
  const asked = useDebouncedValue(search.trim(), 250);
  const found = useProducts({ search: asked || undefined, for_sale: true, per_page: 8 });

  const about = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const closeAll = () => {
    setSaving(false);
    setLines([]);
    setSearch("");
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen && !saving} onClose={closeAll} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          {installments ? "Sell on installments" : startAs === "layaway" ? "Hold goods on advance" : "New quotation"}
        </h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          {installments
            ? "Pick what goes home. The customer, the advance and the months come next."
            : <>Pick what goes on it. The customer, the date{startAs === "layaway" ? " and the advance" : ""} come next.</>}
        </p>

        <Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {asked && deniedReason(found.error) && (
          <div className="mt-1">
            <NoAccess reason={deniedReason(found.error)!} what="the product list" />
          </div>
        )}
        {asked && !deniedReason(found.error) && (
          <div data-testid="document-offers" className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
            {(found.data?.data ?? []).flatMap((p) => offersOf(p)).map((offer) => (
              <button
                key={offer.key}
                type="button"
                disabled={offer.whyNot !== null}
                title={offer.whyNot ?? undefined}
                onClick={() => { setLines((xs) => taken(xs, offer)); setSearch(""); }}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-theme-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent dark:hover:bg-white/5"
              >
                <span className="truncate text-gray-700 dark:text-gray-300">{offer.name}</span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  {offer.left !== null && <span className="text-theme-xs text-gray-400">{offer.left} left</span>}
                  <span className="text-gray-800 dark:text-white/90">{money(offer.price)}</span>
                </span>
              </button>
            ))}
            {!found.isFetching && (found.data?.data ?? []).length === 0 && (
              <p className="px-3 py-2 text-theme-sm text-gray-400">Nothing on sale matches “{asked}”.</p>
            )}
          </div>
        )}

        <div className="mt-4 space-y-2" data-testid="document-lines">
          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-theme-sm text-gray-400 dark:border-gray-800">
              Nothing on it yet — search above and tap an item.
            </p>
          ) : (
            lines.map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 dark:border-gray-800">
                <span className="min-w-0 flex-1 truncate text-theme-sm text-gray-800 dark:text-white/90">{l.name}</span>
                <span className="flex items-center gap-2">
                  <button type="button" aria-label={`One fewer ${l.name}`} className="h-7 w-7 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" onClick={() => setLines((xs) => changed(xs, l.key, -1))}>−</button>
                  <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                  <button type="button" aria-label={`One more ${l.name}`} className="h-7 w-7 rounded bg-brand-500 text-white" onClick={() => setLines((xs) => changed(xs, l.key, 1))}>+</button>
                  <span className="w-24 text-right tabular-nums text-theme-sm text-gray-700 dark:text-gray-300">{money(l.price * l.quantity)}</span>
                </span>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-theme-sm text-gray-500 dark:text-gray-400">
            {lines.length > 0 && <>About <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{money(about)}</span> at shelf prices</>}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={closeAll}>Cancel</Button>
            <Button size="sm" disabled={lines.length === 0} onClick={() => setSaving(true)}>Next</Button>
          </span>
        </div>
      </Modal>

      <StartInstallmentModal
        isOpen={isOpen && saving && installments}
        onClose={() => setSaving(false)}
        lines={lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity }))}
        onDone={(plan) => { onSaved("installments", plan); closeAll(); }}
      />

      <ParkAsDocumentModal
        isOpen={isOpen && saving && !installments}
        onClose={() => setSaving(false)}
        startAs={installments ? "layaway" : startAs}
        lines={lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity }))}
        discount={0}
        customerName=""
        customerPhone=""
        onDone={(kind) => { onSaved(kind); closeAll(); }}
      />
    </>
  );
}
