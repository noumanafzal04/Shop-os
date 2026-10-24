import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router";

import { BackButton } from "./BackButton";

/**
 * The user, 2026-10-24: the Workshop's back button. A page opened from inside
 * the app goes back where it came from; one opened cold goes home, not out of
 * the app.
 */
const app = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/tenant" element={<p>Dashboard</p>} />
        <Route path="/tenant/vehicles" element={<Link to="/tenant/workshop">Take in</Link>} />
        <Route path="/tenant/workshop" element={<BackButton label="Back" />} />
      </Routes>
    </MemoryRouter>,
  );

describe("the back button", () => {
  it("goes back where the person came from", async () => {
    app("/tenant/vehicles");
    fireEvent.click(screen.getByRole("link", { name: "Take in" }));

    fireEvent.click(await screen.findByRole("button", { name: "← Back" }));
    expect(await screen.findByRole("link", { name: "Take in" })).toBeInTheDocument();
  });

  it("goes home when the page was opened cold", async () => {
    app("/tenant/workshop");

    fireEvent.click(await screen.findByRole("button", { name: "← Back" }));
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
  });
});
