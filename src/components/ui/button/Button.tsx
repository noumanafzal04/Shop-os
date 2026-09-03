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
  /**
   * Native button type. **Defaults to `"button"`, not `"submit"`.**
   *
   * It used to have no default, which means the HTML default — and the HTML
   * default for a button inside a form is SUBMIT. Of 305 uses of this component
   * exactly one asked for `submit`, so every other one was relying on not being
   * inside a form. Three were, and the damage was invisible:
   *
   *   "+ Add variant"    submitted the product form, so the item was created
   *                      with ZERO variants and the drawer closed. Reopening it
   *                      is edit mode, where the section is hidden — so the
   *                      variant editor could never be used, and every variant
   *                      in the system had come in through the API.
   *   "+ Group"          the same, for modifier groups.
   *   "Save modifiers"   fired its own mutation AND created the product.
   *
   * A shared control whose default silently submits its surrounding form is a
   * trap that fires once per form somebody writes. The safe default is the inert
   * one; the nine buttons that really are a form's submit now say so.
   */
  type?: "button" | "submit" | "reset";
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
  type = "button",
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
      /* `whitespace-nowrap`: A BUTTON'S LABEL IS NOT A PARAGRAPH.
       *
       * Sixteen screens put a heading and a primary action in one
       * `justify-between` row. Without this, the action is a flex item that
       * shrinks and its label breaks mid-phrase: at 390px "+ New purchase
       * order" became a three-line blue slab a quarter of the screen tall,
       * and "+ New supplier" a two-line one. The shop reported it as the
       * buttons "not showing good", which is exactly what it looks like.
       *
       * Nowrap also stops the button shrinking at all (a flex item's
       * `min-width` is `auto`, so it will not go below its own content), which
       * is what makes the HEADING give way instead — the right half to lose,
       * since a heading reads fine over two lines and a button does not.
       */
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg transition ${className} ${
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
