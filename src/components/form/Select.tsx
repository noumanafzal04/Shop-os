import { useState } from "react";

import { useFieldName } from "../../common/a11y/useFieldName";

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  options: Option[];
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
  defaultValue?: string;
  /**
   * When provided, the select is CONTROLLED by the parent — its shown value
   * always tracks this prop. Use it when the value can change from outside the
   * dropdown (e.g. a map pin setting the city). Omit it for a plain,
   * self-managed select (uncontrolled, seeded by `defaultValue`).
   */
  value?: string;
  /** What this control is CALLED. See the note in InputField for why. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

const Select: React.FC<SelectProps> = ({
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  options,
  placeholder = "Select an option",
  onChange,
  className = "",
  defaultValue = "",
  value,
}) => {
  // Uncontrolled fallback: only used when `value` is not supplied.
  const [internal, setInternal] = useState<string>(defaultValue);
  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : internal;

  // Same fallback as Input: the label above it, when nothing better exists.
  const nameRef = useFieldName();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!isControlled) setInternal(e.target.value);
    onChange(e.target.value);
  };

  return (
    <select
      ref={nameRef}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`h-11 w-full appearance-none rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 pr-11 text-sm shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800 ${
        selectedValue
          ? "text-gray-800 dark:text-white/90"
          : "text-gray-400 dark:text-gray-400"
      } ${className}`}
      value={selectedValue}
      onChange={handleChange}
    >
      {/* Placeholder option */}
      <option
        value=""
        disabled
        className="text-gray-700 dark:bg-gray-900 dark:text-gray-400"
      >
        {placeholder}
      </option>
      {/* Map over options */}
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          className="text-gray-700 dark:bg-gray-900 dark:text-gray-400"
        >
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default Select;
