import { DateRangeFilter } from "../../../components/ui/filters";
import { REPORT_PRESETS, type useReportWindow } from "../hooks/useReportWindow";

/**
 * The one control every money screen picks its dates with.
 *
 * A wrapper so the Cashbook and the Reports page cannot come to offer two
 * different lists: the shop's own named periods (the tax year among them),
 * the rolling windows those names do not cover, and a custom range.
 */
export function ReportWindow({
  when,
  align = "right",
}: {
  when: Pick<ReturnType<typeof useReportWindow>, "range" | "setRange" | "namedPeriods">;
  align?: "left" | "right";
}) {
  return (
    <DateRangeFilter
      label="This month"
      value={{ from: when.range.from, to: when.range.to }}
      onChange={(next) => when.setRange({ from: next.from ?? "", to: next.to ?? "" })}
      extra={when.namedPeriods}
      // The generic list minus the four the shop's own periods already name.
      // Offering "Today" twice, and "This Month" beside "This month", is a
      // menu with two rows for one range and two ticks for one answer. What
      // is left is what the report periods do NOT have: rolling windows, and
      // the month before this one.
      presets={REPORT_PRESETS}
      // A report is ALWAYS about a window. There is no "all time" here: every
      // figure on these screens is a sum over dates, and an unbounded one is
      // a query nobody meant to run.
      allowAll={false}
      align={align}
    />
  );
}
