import { useEffect, useState } from "react";
import { Modal, ModalForm } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import { DOCUMENT_PAPERS, type DocumentPaper } from "../services/documentService";

/**
 * PRINT ON WHICH PAPER — asked on the document's own page only.
 *
 * The user (2026-10-15): the shop sets what its quotations print on, and the
 * till uses that without asking; a reprint from the document asks, with the
 * shop's choice already picked, so one press prints as usual and one more
 * prints this copy on something else.
 */
export function PrintPaperModal({
  isOpen,
  onClose,
  shopPaper,
  onPrint,
}: {
  isOpen: boolean;
  onClose: () => void;
  shopPaper: DocumentPaper;
  onPrint: (paper: DocumentPaper) => void;
}) {
  const [paper, setPaper] = useState<DocumentPaper>(shopPaper);

  // Each time it opens, the shop's own choice — not whatever this copy was last printed on.
  useEffect(() => {
    if (isOpen) setPaper(shopPaper);
  }, [isOpen, shopPaper]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md">
      <ModalForm
        title="Print on"
        footer={
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => onPrint(paper)}>Print</Button>
          </>
        }
      >
        <div role="radiogroup" aria-label="Paper" className="grid grid-cols-3 gap-2">
          {DOCUMENT_PAPERS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={paper === p.value}
              onClick={() => setPaper(p.value)}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                paper === p.value
                  ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                  : "border-gray-300 text-gray-700 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300"
              }`}
            >
              <span className="block text-theme-sm font-semibold">{p.label}</span>
              <span className="block text-theme-xs text-gray-500 dark:text-gray-400">{p.hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-theme-xs text-gray-500 dark:text-gray-400">
          {paper === shopPaper ? "Your shop's usual paper for quotations and advances." : "For this copy only — Settings keeps your shop's usual paper."}
        </p>
      </ModalForm>
    </Modal>
  );
}
