import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "../modal";
import Button from "../button/Button";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Imperative confirm dialog — the ONE place delete/destructive confirmations
 * live. Usage:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Delete plan?", tone: "danger" })) { ...do it }
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }, []);

  const danger = opts?.tone === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        isOpen={!!opts}
        onClose={() => settle(false)}
        showCloseButton={false}
        className="max-w-sm p-6"
      >
        {opts && (
          <>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{opts.title}</h3>
            {opts.message && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{opts.message}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button size="sm" variant="outline" onClick={() => settle(false)}>
                {opts.cancelLabel ?? "Cancel"}
              </Button>
              <button
                autoFocus
                onClick={() => settle(true)}
                className={
                  danger
                    ? "rounded-lg bg-error-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-error-600"
                    : "rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
                }
              >
                {opts.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}
