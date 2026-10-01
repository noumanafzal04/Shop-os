import NotBuiltYet from "../components/NotBuiltYet";

export default function PayrollPage() {
  return (
    <NotBuiltYet
      title="Payroll"
      lead="One run a month, from everything above."
      willDo={[
        "Basic + overtime + commission + bonus − unpaid leave − advance − other",
        "Draft, calculate, review, approve, pay",
        "An approved run is locked; paying it posts the expense",
        "Monthly — the way shops here actually pay",
      ]}
    />
  );
}
