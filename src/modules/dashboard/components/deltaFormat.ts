/**
 * The percentage both consoles' KPI strips print — in its own file because a
 * module that exports a component AND a plain function loses fast refresh for
 * the component, which the lint rule says and a dashboard being tweaked twenty
 * times in a row feels. Same split as `tradeIcon.ts` beside `TradeIcons.tsx`.
 */
/**
 * ONE PERCENTAGE, FORMATTED ONE WAY.
 *
 * Rounded to a decimal place, because "+109.43%" on a dashboard is two digits
 * of noise, and with a real minus sign (−, U+2212) rather than a hyphen, which
 * is a different glyph at a different height and looks like a typo beside a
 * plus. Always signed: an unsigned "5%" beside an arrow is ambiguous.
 */
export function formatDelta(delta: number | null | undefined): string | null {
  if (delta === null || delta === undefined) return null;

  const rounded = Math.round(Math.abs(delta) * 10) / 10;

  return `${delta < 0 ? "−" : "+"}${rounded}%`;
}
