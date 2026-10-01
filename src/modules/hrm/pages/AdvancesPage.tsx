import NotBuiltYet from "../components/NotBuiltYet";

export default function AdvancesPage() {
  return (
    <NotBuiltYet
      title="Advances"
      lead="Money taken before payday, and how it comes back."
      willDo={[
        "Record an advance against a staff member, with approval",
        "A running balance, the way the customer khata already works",
        "Repayment in instalments — 20,000 as 5,000 over four months",
        "Deducted by payroll automatically",
      ]}
    />
  );
}
