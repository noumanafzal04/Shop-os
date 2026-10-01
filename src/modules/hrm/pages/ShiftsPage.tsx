import NotBuiltYet from "../components/NotBuiltYet";

export default function ShiftsPage() {
  return (
    <NotBuiltYet
      title="Shifts & roster"
      lead="The hours each person is expected to work."
      willDo={[
        "Start, end, break, and the grace period before late means late",
        "Overnight shifts — 8pm to 4am finishes the NEXT day",
        "Which days of the week, and which branch",
        "Not the till's cash shift. That is the drawer, this is the hours",
      ]}
    />
  );
}
