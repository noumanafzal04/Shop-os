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
  /**
   * Ask for a line of text as well as a yes.
   *
   * Two screens were reaching past this dialog to `window.prompt` — a
   * cancellation reason, and renaming a till — because asking a question with
   * an answer in it was the one thing it could not do. A grey operating-system
   * box in the middle of the product is a worse answer than a text field.
   *
   * `required: true` disables Confirm until something is typed. Note the
   * distinction the caller has to keep: **empty is not the same as
   * cancelled.** An optional reason left blank still means "yes, go ahead" —
   * which is why the answer comes back as `string | null` and not `""`.
   */
  input?: {
    label?: string;
    placeholder?: string;
    initial?: string;
    required?: boolean;
  };
}

type WithInput = ConfirmOptions & { input: NonNullable<ConfirmOptions["input"]> };

/**
 * Overloaded so the falsy trap cannot be written.
 *
 * A plain confirm answers `boolean`. One that asks for text answers
 * `string | null` — **null is "dismissed", `""` is "confirmed and left
 * blank"**, and those are different answers. Returning `boolean | string`
 * would let `if (await confirm(…))` compile and silently treat an accepted
 * empty reason as a cancellation.
 */
interface ConfirmFn {
  (opts: WithInput): Promise<string | null>;
  (opts: ConfirmOptions): Promise<boolean>;
}

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

type Answer = boolean | string | null;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<((v: Answer) => void) | null>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) => {
      setOpts(o);
      setText(o.input?.initial ?? "");

      return new Promise<Answer>((resolve) => {
        resolver.current = resolve;
      });
    },
    [],
  ) as ConfirmFn;

  const settle = useCallback((result: Answer) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }, []);

  // Dismissing a text question answers null, not false — the caller is typed
  // to expect one shape or the other, never both.
  const dismiss = useCallback(() => settle(opts?.input ? null : false), [opts, settle]);
  const accept = useCallback(() => settle(opts?.input ? text : true), [opts, settle, text]);

  const danger = opts?.tone === "danger";
  const blocked = !!opts?.input?.required && text.trim() === "";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        isOpen={!!opts}
        onClose={dismiss}
        showCloseButton={false}
        className="max-w-sm p-6"
      >
        {opts && (
          <>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{opts.title}</h3>
            {opts.message && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{opts.message}</p>
            )}

            {opts.input && (
              <div className="mt-4">
                {opts.input.label && (
                  <label
                    htmlFor="confirm-input"
                    className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {opts.input.label}
                    {!opts.input.required && (
                      <span className="ml-1 font-normal text-gray-400">(optional)</span>
                    )}
                  </label>
                )}
                <input
                  id="confirm-input"
                  autoFocus
                  value={text}
                  placeholder={opts.input.placeholder}
                  onChange={(e) => setText(e.target.value)}
                  // Enter commits, Esc is already handled by the Modal. A
                  // one-field question should not need the mouse.
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !blocked) {
                      e.preventDefault();
                      accept();
                    }
                  }}
                  className="h-11 w-full rounded-lg border border-gray-300 px-3.5 text-sm text-gray-800 transition focus:border-brand-400 focus:outline-hidden focus:ring-4 focus:ring-brand-400/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button size="sm" variant="outline" onClick={dismiss}>
                {opts.cancelLabel ?? "Cancel"}
              </Button>
              <button
                // The text field wants the focus when there is one.
                autoFocus={!opts.input}
                disabled={blocked}
                onClick={accept}
                className={`rounded-lg px-4 py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  danger ? "bg-error-500 hover:bg-error-600" : "bg-brand-500 hover:bg-brand-600"
                }`}
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
