import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastApi {
  show: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Fire toasts from anywhere: const toast = useToast(); toast.success("Saved"). */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const TONE: Record<ToastType, { ring: string; dot: string; icon: ReactNode }> = {
  success: {
    ring: "border-l-success-500",
    dot: "bg-success-500",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-white">
        <path d="M5 10.5l3.2 3.2L15 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  error: {
    ring: "border-l-error-500",
    dot: "bg-error-500",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-white">
        <path d="M6.5 6.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  info: {
    ring: "border-l-brand-500",
    dot: "bg-brand-500",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-white">
        <path d="M10 9v5m0-8.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
};

function ToastRow({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const tone = TONE[toast.type];
  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border border-l-4 border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-gray-800 dark:bg-gray-900 ${tone.ring}`}
    >
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tone.dot}`}>
        {tone.icon}
      </span>
      <p className="flex-1 text-sm text-gray-700 dark:text-gray-200">{toast.message}</p>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="mt-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
          <path d="M6 6l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = ++idRef.current;
      setToasts((list) => [...list, { id, type, message }]);
      window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
      info: (m) => show(m, "info"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed right-4 top-4 z-[100000] flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <ToastRow key={t.id} toast={t} onClose={() => dismiss(t.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
