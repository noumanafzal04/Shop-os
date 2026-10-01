import NotBuiltYet from "../components/NotBuiltYet";

export default function AttendancePage() {
  return (
    <NotBuiltYet
      title="Attendance"
      lead="Who came, when they came, and how long they worked."
      willDo={[
        "Check in and out by staff PIN at the till, or entered by hand here",
        "A day grid for the whole shop — present, absent, half day, leave",
        "Late, early and overtime minutes worked out from the roster",
        "Auto check-out for the person who forgets, because they do",
      ]}
    />
  );
}
