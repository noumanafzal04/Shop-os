import type React from "react";
import type { FC } from "react";

interface InputProps {
  type?: "text" | "number" | "email" | "password" | "date" | "time" | string;
  id?: string;
  name?: string;
  placeholder?: string;
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  min?: string;
  max?: string;
  step?: number;
  /** id of a <datalist> — suggestions the field offers without restricting it. */
  list?: string;
  /**
   * What a password manager should do with this field. Worth passing on the
   * password screens specifically: without `new-password` on the two new
   * fields, a manager offers the CURRENT password as the autofill for both,
   * and the user saves the password they were trying to replace.
   */
  autoComplete?: string;
  disabled?: boolean;
  success?: boolean;
  error?: boolean;
  hint?: string;
  /**
   * Take the caret when the field appears.
   *
   * For a field that only exists because somebody just asked for it — an inline
   * rename, an "add subcategory" box — making them click it as well is a second
   * step nobody asked for. Not for fields that are simply on the page: stealing
   * focus on load moves the screen under a reader.
   */
  autoFocus?: boolean;
  /**
   * Enter to commit, Escape to give up.
   *
   * Absent until now, which is part of why screens reach past this component
   * for a raw `<input>` — a one-field question should never need the mouse.
   */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /**
   * What this field is CALLED, for anyone who cannot see the label beside it.
   *
   * There was no route to a name at all. Of 360 uses of this component, two
   * passed an `id` and five `<Label>`s passed a matching `htmlFor` — so in
   * practice a field's name was its placeholder, and a placeholder is not a
   * name: it disappears the moment somebody types.
   *
   * Prefer a real `<Label htmlFor>` tied to an `id` where there is a visible
   * label. Use this where there is not — a search box, a date range, a cell in
   * a grid of identical inputs.
   */
  "aria-label"?: string;
  /** id of the element that already names this field, if one is on screen. */
  "aria-labelledby"?: string;
}

const Input: FC<InputProps> = ({
  type = "text",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  id,
  name,
  placeholder,
  value,
  onChange,
  className = "",
  min,
  max,
  step,
  list,
  autoComplete,
  disabled = false,
  success = false,
  error = false,
  hint,
  autoFocus = false,
  onKeyDown,
}) => {
  // `appearance-none` is what made every date field look like a plain text box:
  // it strips the browser's own calendar affordance, so there was nothing to
  // click and no sign the field was a date at all. Native pickers are kept for
  // the date/time family — `date-field` (see index.css) restores the indicator
  // and tints it for dark mode, where the default glyph is black on black.
  const isPicker = ["date", "time", "datetime-local", "month", "week"].includes(type);
  let inputClasses = ` h-11 w-full rounded-lg border ${isPicker ? "date-field" : "appearance-none"} px-4 py-2.5 text-sm shadow-theme-xs placeholder:text-gray-400 focus:outline-hidden focus:ring-3  dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 ${className}`;

  if (disabled) {
    inputClasses += ` text-gray-500 border-gray-300 opacity-40 bg-gray-100 cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700 opacity-40`;
  } else if (error) {
    inputClasses += `  border-error-500 focus:border-error-300 focus:ring-error-500/20 dark:text-error-400 dark:border-error-500 dark:focus:border-error-800`;
  } else if (success) {
    inputClasses += `  border-success-500 focus:border-success-300 focus:ring-success-500/20 dark:text-success-400 dark:border-success-500 dark:focus:border-success-800`;
  } else {
    inputClasses += ` bg-transparent text-gray-800 border-gray-300 focus:border-brand-300 focus:ring-brand-500/20 dark:border-gray-700 dark:text-white/90  dark:focus:border-brand-800`;
  }

  return (
    <div className="relative">
      <input
        type={type}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        id={id}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        min={min}
        max={max}
        step={step}
        list={list}
        autoComplete={autoComplete}
        disabled={disabled}
        className={inputClasses}
      />

      {hint && (
        <p
          className={`mt-1.5 text-xs ${
            error
              ? "text-error-500"
              : success
              ? "text-success-500"
              : "text-gray-500"
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
};

export default Input;
