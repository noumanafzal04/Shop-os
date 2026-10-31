import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { ApiError } from "../../common/types/api";

const login = vi.hoisted(() => ({ error: null as unknown, isPending: false, mutate: vi.fn() }));
vi.mock("../../modules/auth/hooks/useAuth", () => ({ useLogin: () => login }));

import SignInForm from "./SignInForm";

/**
 * #AZ3 — a throttled sign-in named the server's wait ("wait 53 seconds") but
 * did not keep it: three seconds later it still said 53, and the button was
 * live, so the obvious next press pushed the window further out.
 */
describe("signing in after too many tries", () => {
  it("counts the server's wait down, holds the button, then says it is over", () => {
    vi.useFakeTimers();
    login.error = new ApiError("Too many tries in a short time — wait 3 seconds, then try again.", 429, "TOO_MANY_ATTEMPTS", {}, { retry_after: 3 });
    render(<MemoryRouter><SignInForm /></MemoryRouter>);

    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText(/wait 3 seconds, then try again/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Wait 3s" });
    expect(button).toBeDisabled();

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText(/wait 1 second, then try again/)).toBeInTheDocument();
    fireEvent.submit(button.closest("form")!);
    expect(login.mutate).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId("sign-in-wait-over")).toHaveTextContent("you can sign in again now");
    expect(screen.queryByText(/wait \d+ seconds?/)).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    vi.useRealTimers();
  });

  it("a wrong password is still said as it was", () => {
    login.error = new ApiError("These credentials do not match our records.", 422, "INVALID_CREDENTIALS");
    render(<MemoryRouter><SignInForm /></MemoryRouter>);

    expect(screen.getByText("These credentials do not match our records.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});
