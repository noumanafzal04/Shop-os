import { describe, expect, it } from "vitest";

/**
 * ONE PRODUCT, ONE PICTURE — and a way to remove it that can be seen.
 *
 * ── Two failures, one report ────────────────────────────────────────────
 *
 * "Tenant side I am unable to delete previous image … currently zeyda add ho
 * rahi, maine aik KFC main aik image upload ki hai."
 *
 * ADDING: the input was `multiple`, the button said "+ Add photos", and the
 * server appended — so replacing a bad photo produced a SECOND photo and left
 * the bad one first. First is the one that matters: the marketplace card, the
 * aisle, the basket, the offline till's grid and the shop page all draw
 * `images[0]` and nothing anywhere draws the rest. A gallery whose tail is
 * never displayed is not a gallery.
 *
 * DELETING: the ✕ was `opacity-0 … group-hover:opacity-100`. Invisible until a
 * mouse hovered the tile, so on a tablet — or to anybody who did not think to
 * hover — the picture could not be removed at all. The control existed the
 * whole time, which is why it read as broken rather than as missing.
 *
 * ── Why this reads the source ───────────────────────────────────────────
 *
 * `ProductFormPage` is a thousand-line form behind a tenant session, a feature
 * gate and four queries. What is being checked is which control the markup
 * declares — text — so the test reads text, and says so rather than implying
 * it rendered. The behaviour it depends on is proved for real on the server by
 * `FoodShopTest`, which uploads twice and asserts one row and one file.
 */
const read = (glob: Record<string, unknown>): string =>
  Object.values(glob).map((m) => (m as { default: string }).default).join("\n");

const page = read(import.meta.glob("./pages/ProductFormPage.tsx", { query: "?raw", eager: true }));
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const code = codeOnly(page);

/** The photo section only — the form has other file inputs elsewhere. */
const photoBlock = (() => {
  const from = code.indexOf('<Section title="Photo">');
  const to = code.indexOf("</Section>", from);
  return from === -1 ? "" : code.slice(from, to);
})();

describe("the form takes one picture", () => {
  it("has a photo section at all", () => {
    // The anchor every case below slices from. An empty slice would make them
    // all pass against "".
    expect(photoBlock.length).toBeGreaterThan(400);
  });

  it("does not offer a multiple-file picker", () => {
    expect(photoBlock).toContain("<input");
    expect(photoBlock).not.toMatch(/\bmultiple\b/);
  });

  it("takes the first file and not the list", () => {
    expect(photoBlock).toMatch(/e\.target\.files\?\.\[0\]/);
    expect(photoBlock).not.toMatch(/Array\.from\(e\.target\.files/);
  });

  it("replaces what was staged rather than piling up", () => {
    // The create path stages in the browser. `[...prev, ...files]` was the
    // client-side half of the same append.
    expect(photoBlock).toContain("setPendingImages([file])");
    expect(photoBlock).not.toMatch(/setPendingImages\(\(prev\)/);
  });

  it("says replace when there is already one", () => {
    // A button that still says "Add" while the server replaces is a button
    // that lies about what pressing it does.
    expect(photoBlock).toMatch(/hasPhoto[\s\S]{0,80}"Replace photo"/);
  });
});

describe("the picture can be removed without hovering it", () => {
  it("draws a labelled button, not a hover-only cross", () => {
    expect(photoBlock).toMatch(/Remove photo/);
    expect(photoBlock).not.toMatch(/opacity-0/);
    expect(photoBlock).not.toMatch(/group-hover:opacity-100/);
  });

  it("marks it as destructive", () => {
    expect(photoBlock).toMatch(/variant="danger"/);
  });

  it("removes the staged file too, not only a saved row", () => {
    // Before saving there is no row to delete — the only copy is in the
    // browser, and a Remove that did nothing there is the same complaint.
    expect(photoBlock).toContain("setPendingImages([])");
  });
});

describe("one answer about whether a photo exists", () => {
  it("resolves it once instead of re-reading it per control", () => {
    // Three reads is how a form ends up saying "Add photo" above a photo.
    expect(code).toMatch(/const hasPhoto = isEdit \? savedPhoto !== null : stagedPhoto !== null;/);
    expect(code).toMatch(/const photoUrl = isEdit \? \(savedPhoto\?\.url \?\? null\) : stagedPhotoUrl;/);
  });

  it("releases the staged preview's blob URL", () => {
    // A blob URL that is never revoked keeps the whole file in memory for the
    // life of the tab.
    expect(code).toContain("URL.revokeObjectURL(stagedPhotoUrl)");
  });
});
