import { useEffect, useState } from "react";

/**
 * The palette entries apexcharts needs as literal colours. Everything else in
 * the dashboard uses Tailwind classes; a chart can't, so the same tokens are
 * read back out of the CSS custom properties instead of being hardcoded.
 */
const TOKENS = [
  "brand-200",
  "brand-300",
  "brand-400",
  "brand-500",
  "brand-600",
  "brand-700",
  "brand-800",
  "gray-100",
  "gray-300",
  "gray-400",
  "gray-500",
  "gray-800",
  "success-500",
  "error-500",
  "warning-500",
] as const;

export type ChartColors = Record<(typeof TOKENS)[number], string>;

function read(): ChartColors {
  const out = {} as ChartColors;
  if (typeof document === "undefined") return out;

  const style = getComputedStyle(document.documentElement);
  for (const token of TOKENS) {
    out[token] = style.getPropertyValue(`--color-${token}`).trim();
  }

  return out;
}

/**
 * Live chart palette. A tenant's brand ramp is written as inline custom
 * properties on <html> (applyTenantTheme) and dark mode toggles the class on
 * the same element, so watching those two attributes repaints the charts the
 * instant a merchant previews a new colour — no reload, no stale series hue.
 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(read);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setColors(read());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style"] });

    return () => observer.disconnect();
  }, []);

  return colors;
}
