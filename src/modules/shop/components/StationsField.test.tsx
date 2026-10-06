import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { StationsField, stationsFrom } from "./StationsField";

/**
 * Typed, key by key. The box turned every keystroke back into a list and
 * redrew from the list — so Enter (an empty line) and a space at the end of a
 * word were both gone before the next key was pressed.
 */

/** The field as the Settings screen uses it: the parent holds the LIST. */
function Harness({ initial = [], seen }: { initial?: string[]; seen?: (s: string[]) => void }) {
  const [stations, setStations] = useState<string[]>(initial);

  return (
    <div>
      <label>Stations</label>
      <StationsField value={stations} onChange={(next) => { setStations(next); seen?.(next); }} />
      <button type="button" onClick={() => setStations(["Bar"])}>reset from elsewhere</button>
    </div>
  );
}

describe("typing stations", () => {
  it("keeps the Enter, so a second station can be typed at all", async () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    const box = screen.getByRole("textbox");

    await userEvent.type(box, "Kitchen{Enter}Bar");

    expect(box).toHaveValue("Kitchen\nBar");
    expect(seen).toHaveBeenLastCalledWith(["Kitchen", "Bar"]);
  });

  it("keeps the space in a name of two words", async () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    const box = screen.getByRole("textbox");

    await userEvent.type(box, "Hot Grill");

    expect(box).toHaveValue("Hot Grill");
    expect(seen).toHaveBeenLastCalledWith(["Hot Grill"]);
  });

  it("hands up names only — no blank lines, no spaces at the ends", () => {
    expect(stationsFrom("  Kitchen  \n\n Bar\n")).toEqual(["Kitchen", "Bar"]);
    expect(stationsFrom("")).toEqual([]);
  });

  it("starts from what the shop has saved", () => {
    render(<Harness initial={["Kitchen", "Grill"]} />);

    expect(screen.getByRole("textbox")).toHaveValue("Kitchen\nGrill");
  });

  it("redraws when the list is changed from outside, and only then", async () => {
    render(<Harness initial={["Kitchen"]} />);
    const box = screen.getByRole("textbox");

    // Mid-typing: a trailing Enter means nothing yet, and must not be undone.
    await userEvent.type(box, "{Enter}");
    expect(box).toHaveValue("Kitchen\n");

    await userEvent.click(screen.getByRole("button", { name: "reset from elsewhere" }));
    expect(box).toHaveValue("Bar");
  });

  it("answers to the label above it", () => {
    render(<Harness />);

    expect(screen.getByRole("textbox", { name: "Stations" })).toBeInTheDocument();
  });
});
