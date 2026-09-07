import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import BannerPreview from "./BannerPreview";

/**
 * THE PREVIEW EXISTS BECAUSE THE TWO PLACES CROP DIFFERENTLY.
 *
 * The phone lays a banner out at 2:1 (`PromoCarousel`: `width / 2`); the web
 * storefront at roughly 3.5:1 (`h-40 sm:h-48` inside `max-w-2xl`). Both use
 * `object-cover`, so the same artwork keeps its top and bottom on one and
 * loses them on the other — and the form used to say "Recommended 1200×480",
 * a third ratio matching neither.
 *
 * The only way to find out what survived was to publish and go and look.
 */

describe("what it shows", () => {
  it("says nothing useful is possible until there is an image", () => {
    render(<BannerPreview src={null} />);
    expect(screen.getByText(/Pick an image/i)).toBeTruthy();
  });

  it("draws BOTH shapes, and they are different", () => {
    const { container } = render(<BannerPreview src="blob:x" title="Eid deals" />);

    // The two crops, named by the ratio each surface actually uses.
    expect(container.querySelector(".aspect-\\[2\\/1\\]")).toBeTruthy();
    expect(container.querySelector(".aspect-\\[7\\/2\\]")).toBeTruthy();
    // Both actually carry the artwork — a preview of one is not a preview.
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("puts the title on both, because both surfaces draw it", () => {
    render(<BannerPreview src="blob:x" title="Eid deals" />);
    expect(screen.getAllByText("Eid deals")).toHaveLength(2);
  });

  it("draws no band when there is no title", () => {
    // Most banners carry their words inside the artwork; a permanent dark band
    // across every one would be the app editing the advert.
    const { container } = render(<BannerPreview src="blob:x" />);
    expect(container.querySelector("span")).toBeNull();
  });

  it("says what a tap will do, and says so when it will do nothing", () => {
    // The target is three fields — a type, a shop, a URL — and whether they
    // add up to a working link is not readable from any one of them.
    render(<BannerPreview src="blob:x" action="opens Rahat Bakers" />);
    expect(screen.getByText(/Tapping it: opens Rahat Bakers/)).toBeTruthy();
  });

  it("warns about a banner pointing nowhere", () => {
    render(<BannerPreview src="blob:x" action={null} />);
    expect(screen.getByText(/does nothing/i)).toBeTruthy();
  });
});

describe("the preview matches what the two surfaces really do", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

  it("uses the web storefront's own scrim", () => {
    // If the storefront changes how it draws a title, this preview becomes a
    // picture of something that no longer happens — which is worse than no
    // preview, because it is believed.
    const market = read("../../marketplace/pages/MarketPage.tsx");
    expect(market).toMatch(/bg-gradient-to-t from-black\/70/);

    const preview = read("./BannerPreview.tsx");
    expect(preview).toMatch(/bg-gradient-to-t from-black\/70/);
  });

  it("refuses an oversized file HERE, before a pointless upload", () => {
    /**
     * PHP's own `upload_max_filesize` defaults to 2M, and a file over that
     * never reaches Laravel: the upload arrives invalid and the only thing
     * that comes back is "The image failed to upload" — reported verbatim from
     * this form, with a 1200x600 PNG that was simply too big.
     *
     * The rule is 2 MB on both sides now. Checking it in the browser is not
     * belt-and-braces; it is the difference between an answer in a hundred
     * milliseconds and an answer after a two-megabyte upload that was always
     * going to be thrown away.
     */
    const page = read("../pages/AdminBannersPage.tsx");
    expect(page).toMatch(/const MAX_BYTES = 2 \* 1024 \* 1024;/);
    expect(page).toMatch(/if \(f\.size > MAX_BYTES\)/);
    // And it names the size, so the message is about THIS file.
    expect(page).toMatch(/\(f\.size \/ 1024 \/ 1024\)\.toFixed\(1\)/);
  });

  it("refuses the wrong SHAPE here too, for the same reason", () => {
    /**
     * The file size was checked before the upload and the ratio was not, so a
     * 1200x480 banner made it all the way to the server, into storage, into
     * the list, onto the home screen — and appeared cropped. "Banner cutting
     * on mobile, not full banner showing."
     *
     * Same bargain as the size check: the gate is
     * `BannerRequest::checkShape()`, this is the clock.
     */
    const page = read("../pages/AdminBannersPage.tsx");
    expect(page).toMatch(/measureImage\(f\)/);
    expect(page).toMatch(/bannerShapeProblem\(measured\.width, measured\.height\)/);
    // Refused, not warned-and-uploaded: a cropped banner is one somebody paid
    // for.
    expect(page).toMatch(/if \(shape != null\) \{/);
  });

  it("does not blame the phone for a crop the file causes", () => {
    /**
     * The hint used to read "the app crops the edges on narrow phones". The
     * card is the screen width less 32 points and half that in height, so it
     * is 2:1 at EVERY width — the crop comes from the file's ratio and never
     * from the screen.
     *
     * A hint that names the wrong cause is worse than a missing one: it sends
     * somebody to test on more phones.
     */
    const page = read("../pages/AdminBannersPage.tsx");
    expect(page).not.toMatch(/crops the edges on narrow phones/);
    expect(page).toMatch(/same on every phone/);
  });

  it("tells somebody the ratio the phone actually uses", () => {
    // It said "Recommended 1200×480" — 2.5:1 — while the phone draws 2:1, so
    // every banner uploaded to that advice was cropped where a headline goes.
    const page = read("../pages/AdminBannersPage.tsx");
    expect(page).toMatch(/1200×600 \(2:1\)/);
    expect(page).not.toMatch(/1200×480/);
  });

  it("uses the app's own scrim colour for the phone half", () => {
    // The app draws `rgba(12,7,5,0.62)`. A preview in a different black is a
    // preview of a different app.
    expect(read("./BannerPreview.tsx")).toMatch(/rgba\(12,7,5,0\.62\)/);
  });
});
