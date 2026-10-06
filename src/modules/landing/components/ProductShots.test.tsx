import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductShots } from "./ProductShots";

/**
 * The front page's window onto the product: two real screens, and the
 * visitor chooses.
 *
 * What is held is that the picture FILES it names exist — a renamed or
 * forgotten file is a broken image at the top of the page the product is
 * sold from, and nothing else would say so.
 */
const FILES = Object.keys(import.meta.glob("../../../../public/landing/*.webp", { query: "?url", eager: true }))
  .map((path) => path.split("/").pop());

const sources = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("source, img"))
    .flatMap((el) => [el.getAttribute("srcset"), el.getAttribute("src")])
    .filter((v): v is string => !!v)
    .flatMap((v) => v.split(",").map((part) => part.trim().split(" ")[0]));

describe("the two screens", () => {
  it("opens on the dashboard, and shows the till when asked", async () => {
    render(<ProductShots />);

    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
    // One picture is described at a time; the other is in the page, unseen.
    expect(screen.getByRole("img", { name: /owner's dashboard/ })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /till with a sale in progress/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Point of sale" }));

    expect(screen.getByRole("tab", { name: "Point of sale" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("img", { name: /till with a sale in progress/ })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /owner's dashboard/ })).not.toBeInTheDocument();
  });

  it("names only picture files that are really there", () => {
    const { container } = render(<ProductShots />);
    const asked = [...new Set(sources(container))];

    // The denominator: two screens, each at a laptop's size, a small
    // screen's and a phone's.
    expect(asked).toHaveLength(6);
    expect(FILES.length).toBeGreaterThanOrEqual(6);

    const missing = asked.filter((url) => !FILES.includes(url.split("/").pop()));
    expect(missing, `the page asks for pictures that are not in public/landing: ${missing.join(", ")}`).toEqual([]);
  });

  it("gives a phone a phone's picture", () => {
    const { container } = render(<ProductShots />);
    const small = Array.from(container.querySelectorAll('source[media="(max-width: 639px)"]'))
      .map((s) => s.getAttribute("srcset"));

    expect(small).toEqual(["/landing/dashboard-phone.webp", "/landing/pos-phone.webp"]);
  });
});
