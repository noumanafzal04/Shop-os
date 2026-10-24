import { Link, useLocation, useNavigate } from "react-router";

const LOOK =
  "inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03] dark:hover:text-white";

/**
 * A BACK BUTTON THAT LOOKS LIKE ONE.
 *
 * The way off a job card was a line of small grey text, and the Workshop had
 * no way back at all — on a tablet in a workshop, with greasy fingers, a
 * twelve-pixel link is not a button (the user, 2026-10-24).
 *
 * `to` names the list a page belongs to — a job card goes up to its board.
 * Without it the button goes back where the person came from, and to `home`
 * when there is nowhere to go back to: a page opened from a bookmark or a new
 * tab has no history inside the app, and going back would leave it.
 */
export function BackButton({ label, to, home = "/tenant" }: { label: string; to?: string; home?: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  if (to !== undefined) {
    return (
      <Link to={to} className={LOOK}>
        ← {label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={LOOK}
      onClick={() => (location.key !== "default" ? navigate(-1) : navigate(home))}
    >
      ← {label}
    </button>
  );
}
