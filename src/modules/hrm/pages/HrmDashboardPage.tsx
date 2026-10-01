import NotBuiltYet from "../components/NotBuiltYet";

export default function HrmDashboardPage() {
  return (
    <NotBuiltYet
      title="HRM"
      lead="Who is in today, and what the month owes."
      willDo={[
        "Today: staff on roll, present, absent, late, on leave",
        "This month: payroll, overtime, commission and advances",
        "Quick actions — mark attendance, approve leave, run payroll",
      ]}
    />
  );
}
