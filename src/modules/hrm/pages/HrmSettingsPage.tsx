import NotBuiltYet from "../components/NotBuiltYet";

export default function HrmSettingsPage() {
  return (
    <NotBuiltYet
      title="HR settings"
      lead="The policies every figure above is worked out from."
      willDo={[
        "Attendance rules — grace, late, absent after, auto check-out",
        "Overtime: whether it is paid at all, and the multiplier",
        "How a monthly salary becomes a daily rate — 26 days, 30, or the roster",
        "Leave policy: short leave, and what happens past the balance",
        "Advance limits and repayment",
      ]}
    />
  );
}
