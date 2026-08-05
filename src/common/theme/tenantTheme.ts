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

/** ShopOS house brand. Also the fallback whenever a tenant hasn't chosen. */
export const DEFAULT_PRIMARY = "#465fff";

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
export function buildRamp(primary: string): Record<number, string> {
  const base = hexToHsl(primary);
  if (!base) return {};

  const out: Record<number, string> = {};
  for (const [step, lightness] of RAMP) {
    out[step] =
      step === 500
        ? primary.toLowerCase()
        : hslToHex({
            h: base.h,
            // Very light and very dark steps read as muddy at full saturation;
            // easing it off keeps tints airy and shades from going neon.
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
 * unparseable value) restores the ShopOS default, so this is safe to call on
 * every settings load — including when a tenant clears their choice.
 */
export type TintLevel = "none" | "subtle" | "strong";
export type SidebarStyle = "light" | "tinted" | "dark";

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
  const { primary, secondary, tint = "subtle", sidebar = "light" } = options;

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
    // future rebrand of ShopOS needs no change here.
    for (const [step] of RAMP) root.style.removeProperty(`--color-brand-${step}`);
    for (const [step] of NEUTRAL_RAMP) root.style.removeProperty(`--color-gray-${step}`);
    root.style.removeProperty("--brand-ink");
  } else {
    const ramp = buildRamp(chosen);
    for (const [step, hex] of Object.entries(ramp)) {
      root.style.setProperty(`--color-brand-${step}`, hex);
    }
    // Exposed for surfaces that sit directly on the brand colour.
    root.style.setProperty("--brand-ink", contrastInk(chosen));

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
  { name: "ShopOS Blue", primary: DEFAULT_PRIMARY },
  { name: "Emerald", primary: "#12b76a" },
  { name: "Teal", primary: "#0d9488" },
  { name: "Violet", primary: "#7a5af8" },
  { name: "Rose", primary: "#e31b54" },
  { name: "Amber", primary: "#f79009" },
  { name: "Slate", primary: "#475467" },
  { name: "Crimson", primary: "#d92d20" },
];
