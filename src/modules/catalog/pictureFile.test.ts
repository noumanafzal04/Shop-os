import { describe, expect, it } from "vitest";

import { NOT_A_PICTURE, PICTURE_MAX_BYTES, PICTURE_TOO_BIG, pictureRefusal } from "./pictureFile";

/**
 * A REFUSED PICTURE IS SAID IN THE SHOP'S WORDS (#NE1).
 *
 * Phase 9 offered a text file and a 9 MB photo as a product picture. The fence
 * held — 422 and 413 — but the shopkeeper read "The images.0 field must be an
 * image." and "The POST data is too large." The picker knows the server's rule
 * (jpg/png/webp, 4 MB), so it says it before sending.
 */
const MB = 1024 * 1024;

describe("a product picture", () => {
  it("is sent when it is a JPG, PNG or WebP of 4 MB or less", () => {
    expect(pictureRefusal({ type: "image/jpeg", size: 2 * MB })).toBeNull();
    expect(pictureRefusal({ type: "image/png", size: PICTURE_MAX_BYTES })).toBeNull();
    expect(pictureRefusal({ type: "image/webp", size: 1 })).toBeNull();
  });

  it("is refused before sending when it is not a picture, or not one the server takes", () => {
    expect(pictureRefusal({ type: "text/plain", size: 10 })).toBe(NOT_A_PICTURE);
    expect(pictureRefusal({ type: "image/gif", size: 10 })).toBe(NOT_A_PICTURE);
    expect(pictureRefusal({ type: "", size: 10 })).toBe(NOT_A_PICTURE);
  });

  it("is refused before sending when it is over 4 MB — the 9 MB photo of Phase 9", () => {
    expect(pictureRefusal({ type: "image/jpeg", size: 9 * MB })).toBe(PICTURE_TOO_BIG);
    expect(pictureRefusal({ type: "image/jpeg", size: PICTURE_MAX_BYTES + 1 })).toBe(PICTURE_TOO_BIG);
  });

  it("speaks no field name", () => {
    for (const words of [NOT_A_PICTURE, PICTURE_TOO_BIG]) {
      expect(words).not.toMatch(/images\.0|field|POST/);
      expect(words).toMatch(/JPG, PNG or WebP under 4 MB/);
    }
  });
});

describe("the product form asks it before every pick goes anywhere", () => {
  const page = Object.values(
    import.meta.glob("./pages/ProductFormPage.tsx", { query: "?raw", import: "default", eager: true }),
  ).join("\n") as string;

  it("checks the file, and uploads or stages only what passed", () => {
    expect(page).toMatch(/const refused = file \? pictureRefusal\(file\) : null;/);
    expect(page).toMatch(/if \(file && refused === null\) \{\s*if \(isEdit\) \{\s*images\.upload\.mutate\(\[file\]\);/);
    expect(page).toMatch(/data-picture-refused/);
  });
});
