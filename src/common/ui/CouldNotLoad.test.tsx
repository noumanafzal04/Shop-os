import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../types/api";
import { deniedReason, loadFailure } from "../api/denied";
import { CouldNotLoad } from "./CouldNotLoad";

const api = (status: number, message: string, errorCode?: string) => new ApiError(message, status, errorCode);

describe("did this query fail — as opposed to being refused, or finding nothing", () => {
  it("nothing went wrong when there is no error", () => {
    expect(loadFailure(null)).toBeNull();
    expect(loadFailure(undefined)).toBeNull();
  });

  it("a refusal is not a failure — it has its own words", () => {
    const refused = api(403, "This module is not enabled for your shop.", "MODULE_DISABLED");

    expect(deniedReason(refused)).toBe("module");
    expect(loadFailure(refused)).toBeNull();
    expect(loadFailure(api(403, "Forbidden."))).toBeNull();
  });

  it("being slowed down is a failure, in the server's own words", () => {
    expect(loadFailure(api(429, "Too many requests. Please slow down."))).toBe("Too many requests. Please slow down.");
  });

  it("so is an error on the server's side", () => {
    expect(loadFailure(api(500, "Server Error"))).toBe("Server Error");
  });

  it("an answer that never came is said plainly", () => {
    expect(loadFailure(new TypeError("Failed to fetch"))).toBe("The server did not answer.");
    expect(loadFailure(api(0, "  "))).toBe("The server did not answer.");
  });
});

describe("a list that did not load says so, and offers to ask again", () => {
  it("names what it was, says why, and asks again when pressed", async () => {
    const again = vi.fn();
    render(<CouldNotLoad what="the product list" why="Too many requests. Please slow down." onRetry={again} />);

    expect(screen.getByRole("alert")).toHaveTextContent("The product list could not be loaded.");
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests. Please slow down.");
    // Never the screen's own empty state.
    expect(screen.queryByText(/no products match/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("cannot be pressed twice while it is asking", async () => {
    const again = vi.fn();
    render(<CouldNotLoad what="the product list" onRetry={again} busy />);

    const button = screen.getByRole("button", { name: "Trying…" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(again).not.toHaveBeenCalled();
  });
});
