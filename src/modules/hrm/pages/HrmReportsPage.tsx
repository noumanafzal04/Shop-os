import NotBuiltYet from "../components/NotBuiltYet";

export default function HrmReportsPage() {
  return (
    <NotBuiltYet
      title="HR reports"
      lead="Attendance, money and people, per branch."
      willDo={[
        "Daily and monthly attendance, late and absent lists, overtime",
        "Payroll, salary, commission, advances and deductions",
        "Employee-wise sales beside employee-wise commission",
        "Everything scoped to the branch the reader is allowed to see",
      ]}
    />
  );
}
