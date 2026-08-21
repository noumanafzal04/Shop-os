import { useState } from "react";

interface SwitchProps {
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  color?: "blue" | "gray"; // Added prop to toggle color theme
}

const Switch: React.FC<SwitchProps> = ({
  label,
  defaultChecked = false,
  disabled = false,
  onChange,
  color = "blue", // Default to blue color
}) => {
  const [isChecked, setIsChecked] = useState(defaultChecked);

  const handleToggle = () => {
    if (disabled) return;
    const newCheckedState = !isChecked;
    setIsChecked(newCheckedState);
    if (onChange) {
      onChange(newCheckedState);
    }
  };

  const switchColors =
    color === "blue"
      ? {
          background: isChecked
            ? "bg-brand-500 "
            : "bg-gray-200 dark:bg-white/10", // Blue version
          knob: isChecked
            ? "translate-x-full bg-white"
            : "translate-x-0 bg-white",
        }
      : {
          background: isChecked
            ? "bg-gray-800 dark:bg-white/10"
            : "bg-gray-200 dark:bg-white/10", // Gray version
          knob: isChecked
            ? "translate-x-full bg-white"
            : "translate-x-0 bg-white",
        };

  /**
   * A BUTTON, BECAUSE THIS IS A CONTROL.
   *
   * This was a `<label>` with an `onClick` wrapped round two decorative divs:
   * no `<input>`, no `role`, no `tabIndex`. So it was not merely unnamed to a
   * screen reader — it was **unreachable by keyboard entirely**. Its one real
   * use in the app is the Active switch on a till register
   * (modules/registers/components/RegistersPanel), which means a shop that runs
   * without a mouse could not take a lane out of service. Not "could not do it
   * conveniently": there was no key sequence that reached the control.
   *
   * `role="switch"` with `aria-checked` is the pairing that makes on/off
   * audible; before this the state was the pill's colour and nothing else.
   * `type="button"` matters too — this sits inside a form on the registers
   * panel, and a bare <button> there submits it.
   */
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      disabled={disabled}
      className={`flex cursor-pointer select-none items-center gap-3 text-left text-sm font-medium disabled:cursor-not-allowed ${
        disabled ? "text-gray-400" : "text-gray-700 dark:text-gray-400"
      }`}
      onClick={handleToggle}
    >
      <div className="relative">
        <div
          className={`block transition duration-150 ease-linear h-6 w-11 rounded-full ${
            disabled
              ? "bg-gray-100 pointer-events-none dark:bg-gray-800"
              : switchColors.background
          }`}
        ></div>
        <div
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow-theme-sm duration-150 ease-linear transform ${switchColors.knob}`}
        ></div>
      </div>
      {label}
    </button>
  );
};

export default Switch;
