import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Input from "./InputField";

/**
 * ONE KIND OF FIELD CHANGED, AND ONLY THAT KIND.
 *
 *     "lkn check kr lena uski type date arhi hai shared main? baki input ko
 *      khrab na krdy."
 *
 * Every date in the panel is asked for through this one component, so giving
 * `type="date"` a field of its own (DateField) gave it to all thirty-three
 * screens at once. That is only safe if it is `date` and nothing else: there
 * are some 330 other uses of this component — amounts, names, times, PINs —
 * and none of them may notice.
 */

const inAnApp = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("every field that is not a date is exactly the field it was", () => {
  it.each(["text", "number", "email", "password", "tel", "search", "time", "datetime-local", "month", "url"])(
    "type=%s is the browser's own input of that type",
    (type) => {
      inAnApp(<Input type={type} aria-label="The field" value="" onChange={() => {}} />);
      const field = screen.getByLabelText("The field") as HTMLInputElement;

      expect(field.tagName).toBe("INPUT");
      expect(field.getAttribute("type")).toBe(type);
      // Nothing of the date field has been put around it.
      expect(field.hasAttribute("data-date-field")).toBe(false);
      expect(screen.queryByRole("button", { name: /Choose a date/ })).toBeNull();
    },
  );

  it("no type at all is still a text box", () => {
    inAnApp(<Input aria-label="A name" value="Ali" onChange={() => {}} />);

    expect((screen.getByLabelText("A name") as HTMLInputElement).type).toBe("text");
    expect(screen.queryByRole("button", { name: /Choose a date/ })).toBeNull();
  });

  it("hands a number field's own change event to the caller, value and all", () => {
    const changed = vi.fn();
    inAnApp(<Input type="number" aria-label="Amount" value="" onChange={(e) => changed(e.target.value, e.target instanceof HTMLInputElement)} min="0" max="99" step={0.5} />);
    const field = screen.getByLabelText("Amount") as HTMLInputElement;

    fireEvent.change(field, { target: { value: "42.5" } });

    // The real event, from the real element — not something made up in between.
    expect(changed).toHaveBeenCalledWith("42.5", true);
    expect(field.min).toBe("0");
    expect(field.max).toBe("99");
    expect(field.step).toBe("0.5");
  });

  it("keeps a time field the browser's, with its value untouched", () => {
    inAnApp(<Input type="time" aria-label="Opens at" value="09:30" onChange={() => {}} />);

    expect((screen.getByLabelText("Opens at") as HTMLInputElement).value).toBe("09:30");
  });

  it("still says what is wrong under a field that is not a date", () => {
    inAnApp(<Input aria-label="Email" value="x" onChange={() => {}} error hint="That is not an address." />);

    expect(screen.getByText("That is not an address.")).toBeTruthy();
  });
});

describe("a date is the shop's own date field", () => {
  function Bill({ start = "2026-10-12", onDay }: { start?: string; onDay?: (day: string) => void }) {
    const [day, setDay] = useState(start);

    return (
      <>
        <Input type="date" aria-label="Bill date" value={day} onChange={(e) => { setDay(e.target.value); onDay?.(e.target.value); }} min="2026-01-01" max="2026-12-31" />
        <output data-testid="held">{day}</output>
      </>
    );
  }

  it("shows the day as written, not as a machine holds it — and has a calendar to open", () => {
    inAnApp(<Bill />);
    const field = screen.getByLabelText("Bill date") as HTMLInputElement;

    expect(field.hasAttribute("data-date-field")).toBe(true);
    expect(field.value).toBe("12 Oct 2026");
    expect(screen.getByRole("button", { name: /Choose a date/ })).toBeTruthy();
  });

  it("gives the caller the same value a date input always gave: 2026-10-12", () => {
    const got = vi.fn();
    inAnApp(<Bill onDay={got} />);
    const field = screen.getByLabelText("Bill date");

    // Typed the way a person types it…
    fireEvent.change(field, { target: { value: "5/11/2026" } });
    expect(got).toHaveBeenLastCalledWith("2026-11-05");
    // …or the way every existing test fills a date in.
    fireEvent.change(field, { target: { value: "2026-03-09" } });
    expect(got).toHaveBeenLastCalledWith("2026-03-09");
    expect(screen.getByTestId("held").textContent).toBe("2026-03-09");
  });

  it("emptied, it is no date — as an emptied date input was", () => {
    const got = vi.fn();
    inAnApp(<Bill onDay={got} />);

    fireEvent.change(screen.getByLabelText("Bill date"), { target: { value: "" } });

    expect(got).toHaveBeenLastCalledWith("");
  });

  it("never gives the caller something that is not a day, and says so on leaving the box", () => {
    const got = vi.fn();
    inAnApp(<Bill onDay={got} />);
    const field = screen.getByLabelText("Bill date") as HTMLInputElement;

    fireEvent.change(field, { target: { value: "31/02/2026" } });
    expect(got).not.toHaveBeenCalled();
    fireEvent.blur(field);

    // The last real day is back in the box, and is still what the form holds.
    expect(field.value).toBe("12 Oct 2026");
    expect(screen.getByTestId("held").textContent).toBe("2026-10-12");
    expect(screen.getByRole("alert").textContent).toContain("“31/02/2026” is not a date");
  });

  it("keeps to the earliest and latest day it was given", () => {
    const got = vi.fn();
    inAnApp(<Bill onDay={got} />);
    const field = screen.getByLabelText("Bill date") as HTMLInputElement;

    fireEvent.change(field, { target: { value: "12/10/2027" } });
    fireEvent.blur(field);

    expect(got).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("after 31 Dec 2026");
  });

  it("opens a calendar on the month of its day, and a pressed day is the day", () => {
    const got = vi.fn();
    inAnApp(<Bill onDay={got} />);

    fireEvent.click(screen.getByRole("button", { name: /Choose a date/ }));
    const calendar = screen.getByRole("dialog", { name: "Choose a date" });
    expect(calendar.textContent).toContain("October 2026");
    expect(screen.getByRole("button", { name: "12 Oct 2026" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "20 Oct 2026" }));

    expect(got).toHaveBeenLastCalledWith("2026-10-20");
    expect(screen.queryByRole("dialog", { name: "Choose a date" })).toBeNull();
    expect((screen.getByLabelText("Bill date") as HTMLInputElement).value).toBe("20 Oct 2026");
  });

  it("turns the calendar's pages, and will not press a day outside what it was given", () => {
    const got = vi.fn();
    inAnApp(<Bill start="2026-12-30" onDay={got} />);

    fireEvent.click(screen.getByRole("button", { name: /Choose a date/ }));
    // The first days of next year are drawn at the end of December's grid — and are not to be had.
    expect((screen.getByRole("button", { name: "1 Jan 2027" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "The month before" }));
    expect(screen.getByRole("dialog", { name: "Choose a date" }).textContent).toContain("November 2026");
    fireEvent.click(screen.getByRole("button", { name: "15 Nov 2026" }));

    expect(got).toHaveBeenLastCalledWith("2026-11-15");
  });

  it("can be cleared from the calendar", () => {
    const got = vi.fn();
    inAnApp(<Bill onDay={got} />);

    fireEvent.click(screen.getByRole("button", { name: /Choose a date/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(got).toHaveBeenLastCalledWith("");
    expect((screen.getByLabelText("Bill date") as HTMLInputElement).value).toBe("");
  });

  it("closes on Escape without that Escape reaching whatever it sits in", () => {
    const outside = vi.fn();
    document.addEventListener("keydown", outside);
    inAnApp(<Bill />);

    fireEvent.click(screen.getByRole("button", { name: /Choose a date/ }));
    fireEvent.keyDown(screen.getByRole("button", { name: "12 Oct 2026" }), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Choose a date" })).toBeNull();
    // A sheet closes on Escape by listening on the document.
    expect(outside).not.toHaveBeenCalled();
    document.removeEventListener("keydown", outside);
  });

  it("is switched off when the field is", () => {
    inAnApp(<Input type="date" aria-label="Locked" value="2026-10-12" onChange={() => {}} disabled />);

    expect((screen.getByLabelText("Locked") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Choose a date/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
