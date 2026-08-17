import { ReactNode } from "react";

/**
 * The one button.
 *
 * ── Why `danger` had to exist ───────────────────────────────────────────
 *
 * It shipped with exactly two variants, `primary` and `outline`, and no way to
 * say "this one destroys something". So every screen that needed a Remove used
 * `outline` — the same grey ring, the same grey text, sitting immediately
 * beside Edit. On the bank screen that produced five identical grey buttons on
 * one card, of which one deletes a bank and one opens a form.
 *
 * A shop reported it as the screen looking blank. It isn't blank — it is
 * UNDIFFERENTIATED, which reads the same and is worse: nothing is emphasised,
 * so nothing is warned about either.
 *
 * ── Why `danger` is not a red block ─────────────────────────────────────
 *
 * A row action is not the decision. The decision happens in the confirm
 * dialog, which has carried a solid `bg-error-500` all along. If every Remove
 * in a twenty-row table were a red slab, the table would read as an emergency
 * and the actual warning would stop meaning anything.
 *
 * So `danger` carries the WEIGHT of `outline` — same height, same ring, so
 * rows stay calm — and the COLOUR of error. It is unmistakable next to Edit
 * and still quiet at twenty repeats. Red fill stays where the irreversible
 * press is: the dialog.
 *
 * `ghost` is for the third and fourth action on a row, where a ring on
 * everything turns a table into a fence.
 */

interface ButtonProps {
  children: ReactNode; // Button text or content
  size?: "sm" | "md"; // Button size
  /**
   * primary — the one thing this screen is for.
   * outline — a secondary action; safe, reversible.
   * danger  — removes or destroys. Never for the merely irreversible-ish.
   * ghost   — a tertiary action, no ring, for crowded rows.
   */
  variant?: "primary" | "outline" | "danger" | "ghost";
  startIcon?: ReactNode; // Icon before the text
  endIcon?: ReactNode; // Icon after the text
  onClick?: () => void; // Click handler
  disabled?: boolean; // Disabled state
  className?: string; // Disabled state
  type?: "button" | "submit" | "reset"; // native button type (default: submit inside a form)
  title?: string; // native tooltip, for icon-only actions
  "aria-label"?: string; // required when the button has no text
}

const Button: React.FC<ButtonProps> = ({
  children,
  size = "md",
  variant = "primary",
  startIcon,
  endIcon,
  onClick,
  className = "",
  disabled = false,
  type,
  title,
  "aria-label": ariaLabel,
}) => {
  // Size Classes
  const sizeClasses = {
    sm: "px-4 py-3 text-sm",
    md: "px-5 py-3.5 text-sm",
  };

  // Variant Classes
  const variantClasses = {
    primary:
      "bg-brand-500 text-white shadow-theme-xs hover:bg-brand-600 disabled:bg-brand-300",
    outline:
      "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700 dark:hover:bg-white/[0.03] dark:hover:text-gray-300",
    danger:
      "bg-white text-error-600 ring-1 ring-inset ring-error-200 hover:bg-error-50 hover:ring-error-300 dark:bg-gray-800 dark:text-error-400 dark:ring-error-500/30 dark:hover:bg-error-500/10",
    ghost:
      "bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200",
  };

  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-2 rounded-lg transition ${className} ${
        sizeClasses[size]
      } ${variantClasses[variant]} ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      {startIcon && <span className="flex items-center">{startIcon}</span>}
      {children}
      {endIcon && <span className="flex items-center">{endIcon}</span>}
    </button>
  );
};

export default Button;
