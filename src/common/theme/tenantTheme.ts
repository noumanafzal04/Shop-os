import { PRODUCT } from "../../common/brand";
import { oceanBrandWeb } from "./oceanRamp";
/**
 * Per-tenant branding.
 *
 * Tailwind v4 compiles the palette to real CSS custom properties
 * (`--color-brand-500` and friends live on :root), so re-skinning the whole
 * panel is just re-declaring those variables at runtime — every button, active
 * nav item and POS accent follows instantly, in light AND dark, with no
 * rebuild and no stylesheet swap.
 *
 * A tenant picks ONE colour; we derive the 25→950 ramp from it. Semantic
 * colours (success/warning/error) are never themed — green has to keep meaning
 * "good" whatever the brand.
 */

/** True Serve house brand. Also the fallback whenever a tenant hasn't chosen. */
/**
 * The brand's own primary, READ rather than typed.
 *
 * It was `#465fff` — a third blue, agreeing with neither the stylesheet's
 * #0755e9 nor the logo. Three copies of "the primary" is how a product ends
 * up a different colour depending on which screen you are looking at.
 */
export const DEFAULT_PRIMARY = oceanBrandWeb[500];

/**
 * Lightness targets for each ramp step, read off the stock TailAdmin brand
 * scale. The tenant's own hue + saturation ride on top, so any colour produces
 * a ramp with the same contrast rhythm the UI was designed against.
 * Step 500 is special-cased to the EXACT colour they picked.
 */
const RAMP: Array<[step: number, lightness: number]> = [
  [25, 0.97],
  [50, 0.96],
  [100, 0.93],
  [200, 0.88],
  [300, 0.80],
  [400, 0.73],
  [500, 0.64], // replaced by the chosen colour verbatim
  [600, 0.58],
  [700, 0.50],
  [800, 0.41],
  [900, 0.34],
  [950, 0.20],
];

/**
 * The NEUTRAL ramp: page background, sidebar, cards, borders and body text all
 * come from --color-gray-*. Stock TailAdmin greys are already faintly blue, so
 * re-mixing them at the tenant's hue (at a whisper of saturation) carries the
 * brand across every surface instead of stopping at buttons — and because dark
 * mode is built from the SAME variables, both themes shift together.
 *
 * [step, lightness, saturation]. Saturation stays low on purpose: enough that
 * the grey reads as chosen, never enough to tint body copy into a colour cast.
 */
const NEUTRAL_RAMP: Array<[step: number | "dark", lightness: number, saturation: number]> = [
  [25, 0.987, 0.16],
  [50, 0.980, 0.16],
  [100, 0.958, 0.15],
  [200, 0.910, 0.14],
  [300, 0.837, 0.13],
  [400, 0.647, 0.12],
  [500, 0.457, 0.12],
  [600, 0.340, 0.12],
  [700, 0.263, 0.13],
  [800, 0.169, 0.15],
  [900, 0.110, 0.17],
  [950, 0.084, 0.18],
  // TailAdmin's dedicated dark-surface token (dropdowns, dark cards).
  ["dark", 0.145, 0.16],
];

type Hsl = { h: number; s: number; l: number };

/** #rrggbb → HSL. Returns null for anything that isn't a 6-digit hex. */
export function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;

  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `#${[f(0), f(8), f(4)].map((v) => to255(v).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The full brand ramp for a chosen colour, as { step: hex }. The picked colour
 * is used verbatim at 500 so a tenant's exact brand hex is never approximated.
 */
/**
 * The lightness the RAMP table was drawn around — the old indigo's.
 *
 * Every figure in that table is ABSOLUTE: "600 is 0.58 light". That is one
 * step darker than a 500 at 0.64 and one step LIGHTER than a 500 at 0.36,
 * which is what the ocean is, and Teal, Emerald, Slate, Crimson, Rose and
 * Amber besides. For six of the seven presets a shop can pick, the "darker"
 * steps came out paler than the colour itself: a button that lightened when
 * hovered, and `text-brand-600` — which is most of the coloured text in the
 * panel — set in a tint that white could not carry.
 *
 * Nothing showed it, because the default never builds a ramp at all: it uses
 * the hand-tuned one in index.css. It took a shop choosing a colour.
 */
const PIVOT = 0.64;

/**
 * A step's lightness for THIS colour: never on the wrong side of the 500.
 *
 * Above the pivot the table is kept unless the colour is paler than the table
 * assumed, in which case the step moves toward white by the same proportion.
 * Below it, the step moves toward black by the same proportion. A colour at
 * the pivot gets the table exactly, so nothing drawn against it has moved.
 */
function stepLightness(table: number, base: number): number {
  return table >= PIVOT
    ? Math.max(table, base + ((table - PIVOT) / (1 - PIVOT)) * (1 - base))
    : Math.min(table, base * (table / PIVOT));
}

export function buildRamp(primary: string): Record<number, string> {
  const base = hexToHsl(primary);
  if (!base) return {};

  const out: Record<number, string> = {};
  for (const [step, table] of RAMP) {
    const lightness = stepLightness(table, base.l);
    out[step] =
      step === 500
        ? primary.toLowerCase()
        : hslToHex({
            h: base.h,
            s: base.s * (lightness > 0.9 ? 0.9 : lightness < 0.3 ? 0.85 : 1),
            l: lightness,
          });
  }
  return out;
}

/** Readable ink (near-black vs white) for text sitting ON the brand colour. */
export function contrastInk(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const int = parseInt(m[1], 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  // Perceived luminance (ITU-R BT.601) — good enough for a UI foreground pick.
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#101828" : "#ffffff";
}

/**
 * Paint the tenant's colours onto the document. Passing null/undefined (or an
 * unparseable value) restores the True Serve default, so this is safe to call on
 * every settings load — including when a tenant clears their choice.
 */
export type TintLevel = "none" | "subtle" | "strong";
export type SidebarStyle = "light" | "tinted" | "primary" | "dark";

/**
 * THE MENU'S COLOUR WHEN NOBODY HAS CHOSEN ONE.
 *
 * The shop's own colour, edge to edge. It is the default in every place a
 * default is needed — a shop that has never opened Appearance, a demo made a
 * minute ago, and the platform console, which has no Appearance to open — so
 * the product looks like one product before anybody has touched it. White is
 * a choice a shop can make; it stopped being what a shop gets by not choosing.
 *
 * One constant, because "what the sidebar is by default" was written in five
 * files, and the server (ShopSettings::defaults) is a sixth.
 */
export const DEFAULT_SIDEBAR: SidebarStyle = "primary";

/**
 * The sidebar styles, in the order the Appearance canvas offers them.
 *
 * The default FIRST — a default that sits third in its own list reads as an
 * option somebody has to go looking for. White second: the one a shop that
 * wants no colour on its menu will pick.
 */
export const SIDEBAR_CHOICES: ReadonlyArray<{ value: SidebarStyle; label: string }> = [
  // The shop's own colour, edge to edge, white writing on it.
  { value: "primary", label: "Primary" },
  { value: "light", label: "White" },
  { value: "tinted", label: "Tinted" },
  { value: "dark", label: "Dark" },
];

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const int = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((int >> 16) & 255) + 0.7152 * lin((int >> 8) & 255) + 0.0722 * lin(int & 255);
}

/** Contrast of white text on this colour, as WCAG states it. */
export function whiteOn(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/**
 * THE SHADE OF THE BRAND A SIDEBAR CAN BE.
 *
 * "Primary" paints the whole rail in the shop's colour with white writing on
 * it. For the default ocean that is simply the 600 step. But a shop may pick
 * yellow, and white on yellow is a menu nobody can read — so the rail takes
 * the first step of the SAME ramp, 600 downward, that carries white at 4.5:1.
 * The shop still gets its own colour; it gets it dark enough to work.
 *
 * Returns the ramp step's hex. Falls to 950 for a colour so pale that nothing
 * lighter will do, which is still that colour's own darkest shade.
 */
export function railPrimaryFor(primary: string): string {
  const ramp = buildRamp(primary);
  for (const step of [600, 700, 800, 900, 950]) {
    const hex = ramp[step];
    if (hex && whiteOn(hex) >= 4.5) return hex;
  }
  return ramp[950] ?? primary;
}

export interface TenantThemeOptions {
  primary?: string | null;
  secondary?: string | null;
  /** How far the brand hue bleeds into the neutral surfaces. */
  tint?: TintLevel;
  /** The sidebar rail's surface. */
  sidebar?: SidebarStyle;
}

/** Multiplier applied to the neutral ramp's saturation. */
const TINT_STRENGTH: Record<TintLevel, number> = {
  none: 0,      // plain grey — the brand shows only on accents
  subtle: 1,    // a designed hint (default)
  strong: 2.4,  // unmistakably branded surfaces
};

export function applyTenantTheme(options: TenantThemeOptions = {}): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const { primary, secondary, tint = "subtle", sidebar = DEFAULT_SIDEBAR } = options;

  // The sidebar rail reads this in AppSidebar; kept on the root so it survives
  // navigation and applies before the sidebar mounts (no flash of the wrong
  // surface).
  root.dataset.sidebar = sidebar;

  const base = primary ? hexToHsl(primary) : null;
  const chosen = base ? primary! : DEFAULT_PRIMARY;

  if (!base) {
    // No choice (or an unparseable one) — strip every override so the
    // stylesheet's own palette shows through untouched. Removing beats
    // re-setting the defaults: the house look stays pixel-identical, and a
    // future rebrand of True Serve needs no change here.
    for (const [step] of RAMP) root.style.removeProperty(`--color-brand-${step}`);
    for (const [step] of NEUTRAL_RAMP) root.style.removeProperty(`--color-gray-${step}`);
    root.style.removeProperty("--brand-ink");
    // The stylesheet's own fallback (brand-600 of the default ocean) applies.
    root.style.removeProperty("--rail-primary");
  } else {
    const ramp = buildRamp(chosen);
    for (const [step, hex] of Object.entries(ramp)) {
      root.style.setProperty(`--color-brand-${step}`, hex);
    }
    // Exposed for surfaces that sit directly on the brand colour.
    root.style.setProperty("--brand-ink", contrastInk(chosen));
    root.style.setProperty("--rail-primary", railPrimaryFor(chosen));

    // Carry the hue into the neutrals so the sidebar, page background, cards
    // and borders belong to the same family as the accent — on every page and
    // in both light and dark. At tint "none" the greys are left alone.
    const strength = TINT_STRENGTH[tint] ?? 1;
    if (strength === 0) {
      for (const [step] of NEUTRAL_RAMP) root.style.removeProperty(`--color-gray-${step}`);
    } else {
      for (const [step, lightness, saturation] of NEUTRAL_RAMP) {
        root.style.setProperty(
          `--color-gray-${step}`,
          // Cap it: past ~45% the "grey" stops being a neutral and body copy
          // starts reading as coloured text.
          hslToHex({ h: base.h, s: Math.min(saturation * strength, 0.45), l: lightness }),
        );
      }
    }
  }

  // Optional supporting accent. Cleared (not defaulted) when unset, so nothing
  // silently inherits a stale colour after a tenant removes it.
  if (secondary && hexToHsl(secondary)) {
    const sec = buildRamp(secondary);
    for (const [step, hex] of Object.entries(sec)) {
      root.style.setProperty(`--color-accent-${step}`, hex);
    }
    root.style.setProperty("--accent-ink", contrastInk(secondary));
  } else {
    for (const [step] of RAMP) root.style.removeProperty(`--color-accent-${step}`);
    root.style.removeProperty("--accent-ink");
  }
}

/** A few ready-made brands so a merchant isn't forced to hunt for a hex. */
export const THEME_PRESETS: Array<{ name: string; primary: string }> = [
  { name: `${PRODUCT.name} Ocean`, primary: DEFAULT_PRIMARY },
  { name: "Emerald", primary: "#12b76a" },
  { name: "Teal", primary: "#0d9488" },
  { name: "Violet", primary: "#7a5af8" },
  { name: "Rose", primary: "#e31b54" },
  { name: "Amber", primary: "#f79009" },
  { name: "Slate", primary: "#475467" },
  { name: "Crimson", primary: "#d92d20" },
];
