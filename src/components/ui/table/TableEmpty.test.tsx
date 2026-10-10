import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../common/types/api";
import TableEmpty, { type Asked } from "./TableEmpty";

const api = (status: number, message: string, errorCode?: string) => new ApiError(message, status, errorCode);

const asked = (over: Partial<Asked> = {}): Asked => ({ error: null, data: undefined, isFetching: false, refetch: vi.fn(), ...over });

function cell(from: Asked | undefined) {
  return render(
    <table>
      <tbody>
        <tr>
          <TableEmpty colSpan={5} from={from} what="the customer list">
            No customers yet.
          </TableEmpty>
        </tr>
      </tbody>
    </table>,
  );
}

describe("a list with nothing to draw says which of three reasons it is", () => {
  it("empty: the words the screen wrote, as before", () => {
    cell(asked({ data: [] }));

    expect(screen.getByText("No customers yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("failed: it does not say there are no customers — it says the list did not load, and why", () => {
    // "No customers yet" over a 429 is a shop told it has no customers.
    cell(asked({ error: api(429, "Too many requests. Please slow down.") }));

    expect(screen.queryByText("No customers yet.")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("The customer list could not be loaded.");
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests. Please slow down.");
  });

  it("failed with no answer at all is said plainly, and can be asked again", async () => {
    const refetch = vi.fn();
    cell(asked({ error: new TypeError("Failed to fetch"), refetch }));

    expect(screen.getByRole("alert")).toHaveTextContent("The server did not answer.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("while it is being asked again the button says so and cannot be pressed twice", () => {
    cell(asked({ error: api(500, "Server Error"), isFetching: true }));

    expect(screen.getByRole("button", { name: "Trying…" })).toBeDisabled();
  });

  it("refused: a permission is not a failure and not an empty shop", () => {
    cell(asked({ error: api(403, "Forbidden.") }));

    expect(screen.queryByText("No customers yet.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("You do not have access to the customer list.");
  });

  it("refused because the module is off says that instead", () => {
    cell(asked({ error: api(403, "This module is not enabled for your shop.", "MODULE_DISABLED") }));

    expect(screen.getByRole("status")).toHaveTextContent("the customer list is not part of your shop's plan.");
  });

  it("a list that HAS its rows and whose refresh failed is still the list on screen", () => {
    // "Nothing matches these filters" under a filter is the truth about the
    // rows that are there, whatever happened to the last refresh.
    cell(asked({ error: api(500, "Server Error"), data: [{ id: 1 }] }));

    expect(screen.getByText("No customers yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a cell that is not an empty state — Loading… — is told nothing and says what it was given", () => {
    cell(undefined);

    expect(screen.getByText("No customers yet.")).toBeInTheDocument();
  });

  it("keeps the cell spanning the table whichever it is", () => {
    const { container } = cell(asked({ error: api(500, "Server Error") }));

    expect(container.querySelector("td")).toHaveAttribute("colspan", "5");
  });
});
