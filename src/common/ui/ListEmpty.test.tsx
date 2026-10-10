import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Asked } from "../../components/ui/table/TableEmpty";
import { ApiError } from "../types/api";
import { ListEmpty } from "./ListEmpty";

const api = (status: number, message: string, errorCode?: string) => new ApiError(message, status, errorCode);
const asked = (over: Partial<Asked> = {}): Asked => ({ error: null, data: undefined, isFetching: false, refetch: vi.fn(), ...over });

const pass = (from: Asked) =>
  render(
    <ListEmpty from={from} what="the kitchen board">
      <p>All caught up — nothing on the pass.</p>
    </ListEmpty>,
  );

describe("a list that is not a table says which nothing it is", () => {
  it("empty: what the screen wrote, untouched", () => {
    pass(asked({ data: { tickets: [] } }));

    expect(screen.getByText("All caught up — nothing on the pass.")).toBeInTheDocument();
  });

  it("failed: a board that could not be read does not tell a cook the pass is clear", async () => {
    const refetch = vi.fn();
    pass(asked({ error: new TypeError("Failed to fetch"), refetch }));

    expect(screen.queryByText("All caught up — nothing on the pass.")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("The kitchen board could not be loaded.");
    expect(screen.getByRole("alert")).toHaveTextContent("The server did not answer.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("failed, in the server's words, and not pressable twice while it asks again", () => {
    pass(asked({ error: api(429, "Too many requests. Please slow down."), isFetching: true }));

    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests. Please slow down.");
    expect(screen.getByRole("button", { name: "Trying…" })).toBeDisabled();
  });

  it("refused: said as a refusal — a permission, or a module the shop has not got", () => {
    const { unmount } = pass(asked({ error: api(403, "Forbidden.") }));
    expect(screen.getByRole("status")).toHaveTextContent("You do not have access to the kitchen board.");
    expect(screen.queryByText("All caught up — nothing on the pass.")).toBeNull();
    unmount();

    pass(asked({ error: api(403, "Not enabled.", "MODULE_DISABLED") }));
    expect(screen.getByRole("status")).toHaveTextContent("the kitchen board is not part of your shop's plan.");
  });

  it("a list that has its data and whose refresh failed is still the list on screen", () => {
    pass(asked({ error: api(500, "Server Error"), data: { tickets: [] } }));

    expect(screen.getByText("All caught up — nothing on the pass.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
