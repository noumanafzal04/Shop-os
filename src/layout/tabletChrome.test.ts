import { describe, expect, it } from "vitest";

import { DRAWER_BELOW } from "../context/SidebarContext";

/**
 * The shell, at the width a shop actually holds it.
 *
 * Three complaints came off one tablet — "sidebar proper kaam nahi kar rahi",
 * "top header ke saath overlap ho rahi thi", "X close nahi ho rahi thi", and
 * separately "Appearance ka Save button dikh hi nahi raha". Four symptoms,
 * two causes, and both causes are numbers that were written down more than
 * once and drifted.
 *
 * These read source text rather than rendering, which makes them lint rules
 * wearing a test's clothes. That is the honest trade: they cannot prove the
 * tablet looks right — only that the specific arithmetic that broke it cannot
 * quietly come back. Uses import.meta.glob rather than node:fs so it
 * typechecks under the app's browser tsconfig, which has no Node types.
 */

const SOURCES = import.meta.glob("./*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Comments out, code in.
 *
 * Every assertion below hunts for a class name that must or must not be there,
 * and this file's own prose quotes the very strings it forbids — the first run
 * failed on the explanation of the bug rather than the bug. Block and JSX
 * comments go whole; `//` is only honoured at the start of a line, so the
 * `xmlns="http://…"` on every inline SVG keeps its className company.
 */
const stripComments = (src: string): string =>
  src
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

const source = (file: string): string => {
  const key = Object.keys(SOURCES).find((k) => k.endsWith(`/${file}`));
  if (!key) throw new Error(`${file} not found — did it move?`);

  return stripComments(SOURCES[key]);
};

const themeCustomizer = Object.entries(
  import.meta.glob("../components/theme/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
).find(([k]) => k.endsWith("ThemeCustomizer.tsx"))?.[1];
const THEME_CUSTOMIZER = themeCustomizer && stripComments(themeCustomizer);

describe("one width decides whether the rail is pinned or a drawer", () => {
  it("is Tailwind's lg, because that is what every class in the shell already uses", () => {
    // Not a preference — the number is compiled into the stylesheet. Anything
    // else here means the JavaScript and the CSS disagree about what the
    // device is, which is exactly the 768-vs-1024 gap a tablet in portrait
    // (820, 834, 810 CSS px) fell straight into.
    expect(DRAWER_BELOW).toBe(1024);
  });

  it("is read by the header's toggle, never re-typed there", () => {
    const header = source("AppHeader.tsx");

    expect(header).toContain("DRAWER_BELOW");
    // The original bug in one line: `window.innerWidth >= 1024` sitting in
    // this file while SidebarContext believed 768. A literal here is how the
    // two drift apart again.
    expect(header).not.toMatch(/innerWidth\s*[<>]=?\s*\d/);
  });

  it("is the only breakpoint the drawer's own classes split on", () => {
    const sidebar = source("AppSidebar.tsx");
    const translate = sidebar.match(/\b(sm|md|lg|xl|2xl):translate-x-0/g) ?? [];

    // If the rail ever slides in at `md:` while the layout reserves its margin
    // at `lg:`, there is a band where the sidebar covers the page it is
    // supposed to sit beside.
    expect(translate).toEqual(["lg:translate-x-0"]);
  });
});

describe("the drawer does not depend on the header being any particular size", () => {
  const sidebar = () => source("AppSidebar.tsx");

  it("is full height, not offset by a hard-coded header", () => {
    // It was `mt-16 h-[calc(100dvh-4rem)]` — a fixed belief that the header is
    // 64px. Below lg the header is 64 with the account menu shut and roughly
    // 140 with it open, and on a tablet that menu is the only route to
    // notifications, branch and profile. Opening it printed the header over
    // the top of the nav.
    expect(sidebar()).not.toMatch(/mt-16|100dvh-4rem/);
    expect(sidebar()).toContain("inset-y-0");
  });

  it("stacks above the header, so nothing can print over it", () => {
    // The header is z-99999. A drawer that draws underneath it is a drawer
    // with a hole in the corner.
    const z = Number(sidebar().match(/\bz-(\d{4,})\b/)?.[1] ?? 0);

    expect(z).toBeGreaterThan(99999);
  });

  it("carries its own close", () => {
    // The only way out used to be the header's toggle — a control in another
    // component, which the drawer now covers. A drawer you can open and not
    // close is a trap.
    expect(sidebar()).toContain("closeMobileSidebar");
    expect(sidebar()).toMatch(/aria-label="Close menu"/);
  });

  it("closes when you navigate", () => {
    // It never did. On a phone nobody notices; on a tablet the drawer is 290
    // of 820px and the page you asked for loads behind it.
    expect(sidebar()).toMatch(/closeMobileSidebar\(\);\s*\},\s*\[location\.pathname\]/);
  });

  it("only peeks open for a real pointer", () => {
    // Touch fires mouseenter on tap and often never fires mouseleave, so the
    // rail latched open at 290px and reflowed the page beside it.
    expect(sidebar()).toContain("(hover: hover) and (pointer: fine)");
  });
});

describe("the rail's width is one decision, not two", () => {
  it("the page steps aside by exactly what the rail takes", () => {
    // The rail sized itself from `isExpanded || isHovered || isMobileOpen`
    // while the layout stepped aside by `isExpanded || isHovered` — the same
    // question with one term of difference. With the drawer flag set at `lg`
    // or wider the rail drew 290 and the page moved 90, so the dashboard ran
    // underneath the sidebar. A tablet turned upright was how the shop met it.
    //
    // Both now read `railWide` off the context. Neither may rebuild the
    // expression locally, which is the only way they can drift again.
    const layout = source("AppLayout.tsx");
    const sidebar = source("AppSidebar.tsx");

    expect(layout).toContain("railWide");
    expect(sidebar).toContain("railWide");

    for (const file of [layout, sidebar]) {
      expect(file).not.toMatch(/isExpanded\s*\|\|\s*isHovered/);
    }
  });
});

describe("the header is one row that nothing can grow", () => {
  const header = () => source("AppHeader.tsx");

  it("never stacks into a second row", () => {
    // It was a flex COLUMN below `lg`, with branch, theme, notifications and
    // the account folded into a second row behind a three-dots button. At
    // 820 or 1000px there was ample room for all four inline.
    expect(header()).not.toMatch(/\bflex-col\b/);
    expect(header()).toMatch(/\bh-16\b/);
  });

  it("folds only on phones, and into a panel that hangs below it", () => {
    // The height mattered structurally, not only visually: opening the old
    // in-flow row took the header from 64px to ~140, and the sidebar drawer
    // was positioned against a hard-coded 64.
    expect(header()).toMatch(/absolute inset-x-0 top-full/);
    expect(header()).toMatch(/sm:hidden/);
  });

  it("gives a tablet a way to search", () => {
    // The search box is `lg`-only and ⌘K is a keyboard shortcut. Between the
    // two, a tablet had no route to search at all.
    expect(header()).toMatch(/aria-label="Search"/);
  });
});

describe("a panel with a footer measures the viewport that exists", () => {
  it("the Appearance canvas is h-dvh, never h-screen", () => {
    // `h-screen` is 100vh — the height the page WOULD have with the address
    // bar hidden. It isn't hidden. The canvas is a flex column ending in
    // Reset and Save, so the overflow went off the bottom edge and the only
    // scroller is the middle: the merchant could change every colour in the
    // shop and had no Save to press.
    expect(THEME_CUSTOMIZER).toBeDefined();
    expect(THEME_CUSTOMIZER).not.toMatch(/\bh-screen\b/);
    expect(THEME_CUSTOMIZER).toMatch(/\bh-dvh\b/);
  });

  it("its footer cannot be squeezed instead of the list scrolling", () => {
    expect(THEME_CUSTOMIZER).toMatch(/<footer className="flex shrink-0/);
  });

  it("opens ABOVE the shell, not underneath it", () => {
    // It sat at z-60/70/80 while the chrome sits three orders of magnitude
    // higher — header 99999, drawer scrim 100001, drawer 100002. On a desktop
    // nothing overlapped and it looked fine. On a tablet, where the sidebar is
    // a full-height drawer and the header is sticky across the top, the canvas
    // opened underneath both: the close X was under the header and untappable,
    // the sidebar printed over the panel, and the header ran across it from the
    // left. Three complaints, one number.
    //
    // The panel and its scrim are read separately because a scrim that ranks
    // below the header leaves the header live and tappable in front of a modal
    // — which is the same bug wearing the other half's clothes.
    const canvas = THEME_CUSTOMIZER ?? "";
    const zOf = (marker: RegExp): number =>
      Number(canvas.match(marker)?.[1] ?? 0);

    const scrim = zOf(/fixed inset-0 z-(\d{4,}) bg-gray-900\/40/);
    const panel = zOf(/fixed right-0 top-0 z-(\d{4,}) flex h-dvh/);

    expect(scrim).toBeGreaterThan(100002);
    expect(panel).toBeGreaterThan(scrim);
  });

  it("is not offered on a tablet at all", () => {
    // The launcher is `fixed right-0 top-1/2` — a target on the right edge of
    // the glass, which is where a thumb rests while scrolling. On a touch
    // screen the canvas opened by accident, repeatedly, over whatever the shop
    // was doing. Nothing ever opened it "by default": `open` has always
    // started false.
    //
    // `xl`, not `lg`. A tablet in landscape is 1024–1279, which IS `lg`, so
    // hiding below `lg` would have left it on every tablet held the way shops
    // hold them.
    expect(THEME_CUSTOMIZER).toMatch(/className="hidden xl:block"/);
    expect(THEME_CUSTOMIZER).toMatch(/useState\(false\)/);
  });

  it("can be closed by a finger, not only a mouse", () => {
    // The close was `p-1` around a 20px glyph — a 28px target in the top-right
    // corner of a panel pinned to the right edge of the glass. A mouse
    // forgives 28px; a thumb at the edge does not. 44px is the floor, and
    // `size-11` is Tailwind's 44.
    expect(THEME_CUSTOMIZER).toMatch(
      /aria-label="Close"\s*\n\s*className="[^"]*\bsize-11\b/,
    );
  });
});
