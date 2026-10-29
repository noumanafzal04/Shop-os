import { Link } from "react-router";
import { useAuthStore } from "../../stores/authStore";
import { useCan } from "../../stores/useCan";

/**
 * A SHOP THAT CAN ONLY READ SAYS SO ON EVERY SCREEN (admin #AD2).
 *
 * Past its grace a shop's writes are refused — rightly, and in good words —
 * but the only screens that said so were the dashboard and the till. Products,
 * Expenses, Sales and Inventory still offered "+ Add Item", the shopkeeper
 * filled the form in, and the refusal arrived after the press.
 *
 * So it is said by the shell, above the page, on every shop screen. It reads
 * the shop as `useMe` refreshes it on every load, so a renewal clears it
 * without signing out.
 */
export function ReadOnlyBanner() {
  const state = useAuthStore((s) => s.user?.tenant?.subscription_state);
  const can = useCan();

  if (state !== "read_only") return null;

  return (
    <div
      role="status"
      data-read-only-banner
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-error-600 px-4 py-2 text-center text-theme-xs font-medium text-white"
    >
      <span>
        <strong className="font-semibold">Read-only</strong> — this shop&apos;s plan has ended. You can look at
        everything, but nothing can be added or changed until it is renewed. No data is lost.
      </span>
      {/* Only somebody who may open the plan's page is sent to it. */}
      {can("settings.manage") && (
        <Link
          to="/tenant/subscription"
          className="rounded-md bg-white/15 px-2.5 py-1 font-semibold transition hover:bg-white/25"
        >
          Renew
        </Link>
      )}
    </div>
  );
}
