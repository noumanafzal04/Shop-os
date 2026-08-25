import { hasShape } from "./sparkShape";

/**
 * The last seven days of one figure, drawn behind its KPI tile.
 *
 * Deliberately hand-drawn SVG rather than a seventh apexcharts instance: six of
 * these on first paint is six chart runtimes for ~40px of shape, and the tile
 * only needs to answer "which way is this going" — a question a shape answers
 * faster than the delta pill next to it can.
 *
 * The series is the same `sales_series` the trend chart draws, so the two can
 * never disagree. Nothing is drawn for a shop with fewer than two days of
 * history, because a single point has no direction to show.
 */
export function Sparkline({ points }: { points: number[] }) {
  // A WEEK OF NOTHING HAS NO SHAPE, and neither has a single day. An all-zero
  // series drew a level line with the area under it filled, which on a shop
  // that has not sold yet reads as volume — the FIGURE already says zero, and
  // the shape was adding a claim that is not true.
  //
  // The same question decides whether the tile reserves room for this, so it
  // is asked in one place. See `sparkShape`.
  if (!hasShape(points)) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const step = 100 / (points.length - 1);

  // A flat week is real — it draws as a level line rather than collapsing to
  // the floor, which would read as "sales stopped".
  const y = (value: number) => (span === 0 ? 15 : 30 - ((value - min) / span) * 26 - 2);

  const line = points.map((value, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${y(value).toFixed(2)}`).join(" ");

  return (
    <svg
      aria-hidden
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="absolute inset-x-0 bottom-0 h-10 w-full"
    >
      <path d={`${line} L100,30 L0,30 Z`} fill="currentColor" opacity="0.08" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
