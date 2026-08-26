import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DateRangeFilter } from "./DateRangeFilter";
import { EMPTY_RANGE, type DateRange } from "./dateRanges";

/**
 * The behaviours somebody would actually notice, and that the arithmetic tests
 * next door cannot see: what the trigger says, what the menu ticks, and — the
 * one that matters — that a half-picked custom range changes nothing behind it
 * until Apply.
 */
function Harness({ initial = EMPTY_RANGE }: { initial?: DateRange }) {
  const [range, setRange] = useState<DateRange>(initial);

  return (
    <>
      <DateRangeFilter label="Any date" value={range} onChange={setRange} />
      {/* What the page under the filter is showing, so a change that should
          not have happened yet is visible when it does. */}
      <output data-testid="applied">{`${range.from ?? "-"}..${range.to ?? "-"}`}</output>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 7, 26, 9, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A day cell, addressed the way a screen reader hears it.
 *
 * Formatted with the same call the component uses rather than a hardcoded
 * string: the accessible name is deliberately locale-dependent — that is the
 * point of it — and pinning "10 August 2026" here would make the suite fail
 * for anyone whose machine is set to a locale that writes it the other way
 * round, which proves nothing about the component.
 */
const dayCell = (year: number, month: number, day: number): string =>
  new Date(year, month, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /any date|aug/i }));
};

describe("the date filter", () => {
  it("shows the label until something is chosen, then shows the choice", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Nothing chosen: the trigger names the AXIS. Naming the value here
    // would read "All time" over an unfiltered list, which is a filter
    // claiming to be doing something.
    expect(screen.getByRole("button", { name: /any date/i })).toBeInTheDocument();

    await open(user);
    await user.click(screen.getByRole("option", { name: /last 7 days/i }));

    // The trigger reads the RANGE, not the word "Date". A toolbar that names
    // its own axes and not its values is a toolbar you have to open to read.
    expect(screen.getByRole("button", { name: /20 – 26 Aug/ })).toBeInTheDocument();
    expect(screen.getByTestId("applied")).toHaveTextContent("2026-08-20..2026-08-26");
  });

  it("prints the dates each preset resolves to, beside its name", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);

    // The whole point of the control: the name is how somebody thinks, the
    // dates are what they opened it to check.
    expect(within(screen.getByRole("option", { name: /last 30 days/i })).getByText("28 Jul – 26 Aug")).toBeInTheDocument();
    expect(within(screen.getByRole("option", { name: /^this month/i })).getByText("1 – 26 Aug")).toBeInTheDocument();
  });

  it("ticks the preset a pair of loose dates happens to be", async () => {
    const user = userEvent.setup();
    // Arriving from a URL, a bookmark or the back button: the state is two
    // dates and no name. Without matchPreset the menu would tick nothing over
    // a filtered screen.
    render(<Harness initial={{ from: "2026-08-01", to: "2026-08-26" }} />);
    await open(user);

    expect(screen.getByRole("option", { name: /^this month/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /^today/i })).toHaveAttribute("aria-selected", "false");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("the custom range dialog", () => {
  const openCustom = async (user: ReturnType<typeof userEvent.setup>) => {
    await open(user);
    await user.click(screen.getByRole("button", { name: /custom range/i }));
  };

  it("changes nothing behind it until Apply", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openCustom(user);

    await user.click(screen.getByRole("button", { name: dayCell(2026, 7, 10) }));
    await user.click(screen.getByRole("button", { name: dayCell(2026, 7, 14) }));

    // Two days picked, and the list underneath has not moved. A picker that
    // filtered as you clicked would refilter twice per range, and the first
    // of those two filters is always wrong.
    expect(screen.getByTestId("applied")).toHaveTextContent("-..-");

    await user.click(screen.getByRole("button", { name: /apply range/i }));
    expect(screen.getByTestId("applied")).toHaveTextContent("2026-08-10..2026-08-14");
  });

  it("orders the two ends whichever way round they were clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openCustom(user);

    await user.click(screen.getByRole("button", { name: dayCell(2026, 7, 20) }));
    await user.click(screen.getByRole("button", { name: dayCell(2026, 7, 3) }));
    await user.click(screen.getByRole("button", { name: /apply range/i }));

    expect(screen.getByTestId("applied")).toHaveTextContent("2026-08-03..2026-08-20");
  });

  it("cannot apply half a range", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openCustom(user);

    expect(screen.getByRole("button", { name: /apply range/i })).toBeDisabled();
    // …and it says what is missing rather than only refusing.
    expect(screen.getByText("Select a start and end date")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: dayCell(2026, 7, 10) }));
    expect(screen.getByText("Now pick the end date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply range/i })).toBeDisabled();
  });

  it("leaves the filter alone when cancelled", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: "2026-08-01", to: "2026-08-05" }} />);
    await openCustom(user);

    await user.click(screen.getByRole("button", { name: dayCell(2026, 7, 12) }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.getByTestId("applied")).toHaveTextContent("2026-08-01..2026-08-05");
  });

  it("does not hand back a range abandoned the last time it was open", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openCustom(user);
    await user.click(screen.getByRole("button", { name: dayCell(2026, 7, 7) }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await openCustom(user);

    // A dialog that kept yesterday's abandoned first click would offer it as
    // today's start date, and the next single click would silently complete a
    // range nobody meant.
    expect(screen.getByText("Select a start and end date")).toBeInTheDocument();
  });

  it("gives each day cell a name that says which month it is in", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openCustom(user);

    // Two months on screen means "10" is 10 August and also 10 September:
    // two controls with one name. Sighted users read the column and the
    // heading above it; a screen reader hears a list of numbers repeated
    // twice with nothing to tell them apart.
    expect(screen.queryAllByRole("button", { name: "10" })).toHaveLength(0);
    expect(screen.getByRole("button", { name: dayCell(2026, 7, 10) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: dayCell(2026, 8, 10) })).toBeInTheDocument();
  });

  it("shows two months, because crossing one is why anybody opens it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openCustom(user);

    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });
});
