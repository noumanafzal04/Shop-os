import { useOfflineStore } from "../offlineStore";
import { storageWarning } from "./persist";

/**
 * "This device might not keep your sales."
 *
 * Shown where it can still change what somebody does — at the top of the shift
 * they are about to open, not after a day's takings have already been rung into
 * a browser that will throw them away.
 *
 * It WARNS and never blocks. A shop refused its own till because Chrome would
 * not grant durable storage is a shop that cannot trade, which is a far worse
 * outcome than the risk being warned about. The decision belongs to the person
 * who owns the money.
 *
 * Silent when the storage answer is fine, unknown, or unactionable — see
 * `storageWarning`, which holds the wording so the same sentence can appear on
 * the shift screen, in settings and in a support reply.
 */
export default function StorageWarning({ className = "" }: { className?: string }) {
  const storage = useOfflineStore((s) => s.storage);
  const message = storage ? storageWarning(storage) : null;

  if (!message) return null;

  return (
    <div
      role="status"
      className={`rounded-lg border border-warning-200 bg-warning-50 p-3 text-theme-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400 ${className}`}
    >
      {message}
    </div>
  );
}
