import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ClosedTodayCard from "./ClosedTodayCard";
import type { ClosedToday } from "../services/dayService";

/**
 * The screen a shop meets after "Close off the day" was pressed by mistake.
 * It used to say "No day open yet" — these are what it must say instead, and
 * the one press that gets the shop trading again.
 */
const closed = (over: Partial<ClosedToday> = {}): ClosedToday => ({
  id: "day-1",
  trading_date: "2026-10-06",
  closed_at: "2026-10-06T09:00:00Z",
  closed_by: "Sana",
  branch: "Gulberg",
  sales_total: 48500,
  can_reopen: true,
  ...over,
});

const show = (over: Partial<ClosedToday> = {}, onReopen = vi.fn(), busy = false) => {
  render(
    <ClosedTodayCard
      closed={closed(over)}
      date="Tue, 6 Oct 2026"
      closedAt="2:00 pm"
      money={(n) => `Rs ${n.toLocaleString("en-PK")}`}
      busy={busy}
      onReopen={onReopen}
    />,
  );

  return onReopen;
};

describe("today was closed off", () => {
  it("says what happened: which day, where, when, by whom, and what it had taken", () => {
    show();

    const card = screen.getByTestId("closed-today");
    expect(card).toHaveTextContent("Tue, 6 Oct 2026 has been closed off");
    expect(card).toHaveTextContent("Gulberg · closed at 2:00 pm by Sana · Rs 48,500 in sales.");
    expect(card).toHaveTextContent("No shift can open on a closed day");
  });

  it("does not invent a branch or a name it was not given", () => {
    show({ branch: null, closed_by: null });

    // Exactly this, straight after the heading: no "Gulberg · " before it and
    // no "by …" after the time.
    expect(screen.getByTestId("closed-today")).toHaveTextContent("closed offclosed at 2:00 pm · Rs 48,500 in sales.");
  });

  it("offers the way back to somebody who may take it", () => {
    show();

    expect(screen.getByRole("button", { name: "Open today again" })).toBeInTheDocument();
    expect(screen.getByTestId("closed-today")).toHaveTextContent("open it again and carry on");
  });

  it("offers a cashier no button that would refuse them, and says who can", () => {
    show({ can_reopen: false });

    expect(screen.queryByRole("button", { name: "Open today again" })).not.toBeInTheDocument();
    expect(screen.getByTestId("closed-today")).toHaveTextContent("a manager can open it again from this screen");
  });
});

describe("opening it again", () => {
  const ask = () => fireEvent.click(screen.getByRole("button", { name: "Open today again" }));
  const type = (text: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  const confirm = () => screen.getByRole("button", { name: "Open it again" });

  it("asks why before it does anything", () => {
    const onReopen = show();

    ask();

    expect(screen.getByText("Why is it being opened again?")).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    expect(onReopen).not.toHaveBeenCalled();
  });

  it("will not take a reason that is not one", () => {
    const onReopen = show();
    ask();

    type("ok");
    expect(confirm()).toBeDisabled();
    type("     ");
    expect(confirm()).toBeDisabled();
    fireEvent.click(confirm());

    expect(onReopen).not.toHaveBeenCalled();
  });

  it("sends the reason as it was meant, once", async () => {
    const onReopen = show({}, vi.fn().mockResolvedValue(undefined));
    ask();

    type("  Closed off by mistake at 2 pm  ");
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());

    await waitFor(() => expect(onReopen).toHaveBeenCalledTimes(1));
    expect(onReopen).toHaveBeenCalledWith("Closed off by mistake at 2 pm");
    // The sheet goes away; a second press has nothing to land on.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open it again" })).not.toBeInTheDocument());
  });

  it("cannot be pressed twice while the first press is still on its way", () => {
    const onReopen = show({}, vi.fn(), true);
    ask();
    type("Closed by mistake");

    const button = screen.getByRole("button", { name: "Opening…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(onReopen).not.toHaveBeenCalled();
  });

  it("changes nothing when cancelled", () => {
    const onReopen = show();
    ask();
    type("Closed by mistake");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onReopen).not.toHaveBeenCalled();
    expect(screen.queryByText("Why is it being opened again?")).not.toBeInTheDocument();
  });
});
