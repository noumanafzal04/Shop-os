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

  const size = Math.abs(delta);

  // PAST TENFOLD, SAY IT AS A MULTIPLE.
  //
  // A shop that took Rs 668 yesterday and Rs 28,992 today was told
  // "+4240.3%". True, and nobody reads it: a percentage stops meaning
  // anything to the eye somewhere around a thousand. "43×" is the same fact
  // in the form a person would say it — forty-three times yesterday.
  //
  // Only upward. A fall cannot pass −100%, so there is no large negative to
  // tidy.
  if (delta >= 1000) return `${Math.round(delta / 100 + 1)}×`;

  // In the hundreds the tenth of a percent is noise: "+250%", not "+250.3%".
  const rounded = size >= 100 ? Math.round(size) : Math.round(size * 10) / 10;

  return `${delta < 0 ? "−" : "+"}${rounded}%`;
}
