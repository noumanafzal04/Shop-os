import NotBuiltYet from "../components/NotBuiltYet";

export default function CommissionPage() {
  return (
    <NotBuiltYet
      title="Commission"
      lead="What a sale earns the person who made it."
      willDo={[
        "Percentage or fixed, across everything or per category or product",
        "Earned by whoever the sale names as the seller",
        "Reversed when a sale is returned or voided — the one rule that cannot bend",
        "Carried into payroll as an earning",
      ]}
    />
  );
}
