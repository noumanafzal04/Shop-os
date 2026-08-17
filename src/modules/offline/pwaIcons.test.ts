import { describe, expect, it } from "vitest";

/**
 * The icon a shop taps to open the till.
 *
 * All three manifest entries pointed at `favicon.png` — which is **48×48** —
 * while declaring themselves 192, 512 and 512-maskable. Saying a 48px file is
 * 512px does not make it one: the browser READS the image, finds nothing at
 * the sizes an installable app must offer, and quietly rules the app not
 * installable. No error, no warning, no install prompt, nothing to search for.
 *
 * So "how do we give the till a desktop icon" had **two** blockers and only
 * one of them was famous. HTTPS is the one everybody names. This is the other,
 * and it would have kept the prompt away on a perfectly good `https://` origin
 * while everyone looked at the certificate.
 *
 * `maskable` is a separate drawing, never the same file relabelled. Android
 * crops a maskable icon to whatever shape the launcher uses — circle,
 * squircle, teardrop — so the artwork must be full-bleed with its content
 * inside the middle ~60%. Hand it the rounded-square badge and the launcher
 * cuts the badge's own corners off, and the mark inside with them.
 *
 * ── Why it reads the pixels ─────────────────────────────────────────────
 *
 * A declared size the file does not have IS the bug, so nothing short of the
 * file itself is worth asserting against. Vite's `?inline` hands over the
 * bytes as a data URI regardless of the inline limit; PNG stores width and
 * height as big-endian uint32 at offsets 16 and 20, straight after the IHDR
 * marker. No `node:fs` — this app's tsconfig deliberately carries no Node
 * types, so that nobody can reach for `process.env` in a component and have
 * the compiler agree.
 */

const ICONS = import.meta.glob("../../../public/icon-*.png", {
  query: "?inline",
  import: "default",
  eager: true,
}) as Record<string, string>;

const CONFIG = Object.values(
  import.meta.glob("../../../vite.config.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
)[0];

interface Declared {
  src: string;
  sizes: string;
  purpose: string;
}

/** The `icons: [...]` entries as the manifest actually declares them. */
const declared = (): Declared[] => {
  const block = CONFIG.match(/icons:\s*\[([\s\S]*?)\],/)?.[1] ?? "";

  return [...block.matchAll(/\{[^}]*\}/g)].map((m) => ({
    src: m[0].match(/src:\s*"([^"]+)"/)?.[1] ?? "",
    sizes: m[0].match(/sizes:\s*"([^"]+)"/)?.[1] ?? "",
    purpose: m[0].match(/purpose:\s*"([^"]+)"/)?.[1] ?? "",
  }));
};

/** Width and height out of a PNG's IHDR chunk. */
const pngSize = (publicPath: string): { w: number; h: number } => {
  const key = Object.keys(ICONS).find((k) => k.endsWith(publicPath));
  if (!key) throw new Error(`${publicPath} is not in public/`);

  const bytes = Uint8Array.from(atob(ICONS[key].split(",")[1]), (c) => c.charCodeAt(0));
  const ascii = String.fromCharCode(...bytes.slice(12, 16));
  if (ascii !== "IHDR") throw new Error(`${publicPath} is not a PNG`);

  const be32 = (at: number) =>
    (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];

  return { w: be32(16), h: be32(20) };
};

describe("the app is installable at all", () => {
  it("declares icons, and they are on disk", () => {
    // The denominator, twice over: a regex that stopped matching would report
    // a perfect score against an empty list, and a glob that resolved to
    // nothing would make every size check vacuous.
    expect(declared().length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(ICONS).length).toBeGreaterThanOrEqual(3);
  });

  it("every icon file is the size it claims", () => {
    const lies = declared()
      .map((icon) => {
        const [w, h] = icon.sizes.split("x").map(Number);
        const real = pngSize(icon.src);

        return real.w === w && real.h === h
          ? null
          : `${icon.src} says ${icon.sizes} and is ${real.w}x${real.h}`;
      })
      .filter(Boolean);

    expect(lies).toEqual([]);
  });

  it("offers the two sizes an install prompt requires", () => {
    const sizes = new Set(declared().map((i) => i.sizes));

    expect(sizes.has("192x192")).toBe(true);
    expect(sizes.has("512x512")).toBe(true);
  });

  it("draws maskable separately from the badge", () => {
    const maskable = declared().filter((i) => i.purpose === "maskable");
    const plain = declared().filter((i) => i.purpose !== "maskable");

    expect(maskable.length).toBeGreaterThan(0);
    // The same file under both purposes is the relabelling this exists to
    // stop: a launcher's crop would take the badge's rounded corners off.
    for (const m of maskable) {
      expect(plain.map((p) => p.src)).not.toContain(m.src);
    }
  });

  it("no icon is the 48px favicon wearing a bigger label", () => {
    expect(declared().map((i) => i.src)).not.toContain("/favicon.png");
  });
});
