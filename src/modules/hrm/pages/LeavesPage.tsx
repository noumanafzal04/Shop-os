import NotBuiltYet from "../components/NotBuiltYet";

export default function LeavesPage() {
  return (
    <NotBuiltYet
      title="Leaves"
      lead="Requests, approvals and what each person has left."
      willDo={[
        "Leave types a shop defines itself, each paid or unpaid",
        "Request, approve or reject — the balance moves on APPROVAL, not on asking",
        "Half days and short leave in hours",
        "An approved leave writes the attendance day, so leave lives in one place",
      ]}
    />
  );
}
