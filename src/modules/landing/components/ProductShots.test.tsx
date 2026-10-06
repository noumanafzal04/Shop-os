import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProductShot, type ShotKey } from "./ProductShots";

/**
 * The front page's photographs of the product: a window, and the same screen
 * on a phone in front of it.
 *
 * What is held is that the picture FILES each one names exist — a renamed or
 * forgotten file is a broken image at the top of the page the product is
 * sold from, and nothing else would say so — and that the pair really is a
 * pair.
 */
const FILES = Object.keys(import.meta.glob("../../../../public/landing/*.webp", { query: "?url", eager: true }))
  .map((path) => path.split("/").pop());

const KEYS: ShotKey[] = ["dashboard", "pos"];

const sources = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("source, img"))
    .flatMap((el) => [el.getAttribute("srcset"), el.getAttribute("src")])
    .filter((v): v is string => !!v)
    .flatMap((v) => v.split(",").map((part) => part.trim().split(" ")[0]));

describe("the pictures are there", () => {
  it("names only picture files that are really in public/landing", () => {
    const asked = new Set<string>();
    for (const shot of KEYS) {
      const { container, unmount } = render(<ProductShot shot={shot} />);
      sources(container).forEach((url) => asked.add(url));
      unmount();
    }

    // The denominator: two screens, each at a laptop's size, a small
    // screen's and a phone's.
    expect([...asked]).toHaveLength(6);
    expect(FILES.length).toBeGreaterThanOrEqual(6);

    const missing = [...asked].filter((url) => !FILES.includes(url.split("/").pop()));
    expect(missing, `the page asks for pictures that are not in public/landing: ${missing.join(", ")}`).toEqual([]);
  });

  it.each(KEYS)("%s: says what the picture shows, once", (shot) => {
    render(<ProductShot shot={shot} />);

    // The window is described; the phone in front of it is the same screen
    // again and says nothing a second time.
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img").getAttribute("alt")).toMatch(shot === "pos" ? /till with a sale in progress/ : /owner's dashboard/);
  });
});

describe("the same screen, at two sizes", () => {
  it.each(KEYS)("%s: the phone beside the window shows the same screen", (shot) => {
    // Asked for by the owner: "POS ke sath POS mobile ki lagao". The phone is
    // the screen in the window, in a hand — not a different screen.
    const { container } = render(<ProductShot shot={shot} />);
    const inHand = Array.from(container.querySelectorAll<HTMLImageElement>("img"))
      .filter((img) => img.closest("picture") === null)
      .map((img) => img.getAttribute("src"));

    expect(inHand).toEqual([`/landing/${shot}-phone.webp`]);
    // …and the window is the same screen too.
    expect(container.querySelector("picture img")?.getAttribute("src")).toBe(`/landing/${shot}-1280.webp`);
  });

  it.each(KEYS)("%s: a small screen is given the phone's picture in the window itself", (shot) => {
    const { container } = render(<ProductShot shot={shot} />);

    expect(container.querySelector('source[media="(max-width: 639px)"]')?.getAttribute("srcset"))
      .toBe(`/landing/${shot}-phone.webp`);
  });
});

describe("what the page opens on is fetched first", () => {
  it("the hero's picture is eager; the rest wait until they are near", () => {
    const hero = render(<ProductShot shot="dashboard" first />);
    expect(hero.container.querySelector("picture img")?.getAttribute("loading")).toBe("eager");
    hero.unmount();

    const later = render(<ProductShot shot="pos" />);
    expect(later.container.querySelector("picture img")?.getAttribute("loading")).toBe("lazy");
  });
});
