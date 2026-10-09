/**
 * Whether a series has a shape worth drawing — asked in TWO places, so it
 * cannot be answered differently in each.
 *
 * `Sparkline` returns null for a week of zeros, because an all-zero series
 * drew a level line with the area under it filled and that reads as volume on
 * a shop that has not sold anything. But `MetricTile` reserves the room for
 * that sparkline from the presence of the `spark` prop alone — so the tile
 * kept a strip of padding for a drawing that had decided not to appear, and
 * three tiles carried an empty gap under their labels.
 *
 * One predicate, both callers.
 */
export function hasShape(points: number[] | undefined): points is number[] {
  return points !== undefined && points.length > 1 && points.some((value) => value !== 0);
}

/** As many bars as the filled tile has room for beside its figure. */
export const MOST_BARS = 14;

/** How many points of a series one bar stands for, at that width. */
export function pointsPerBar(points: number, most: number = MOST_BARS): number {
  return Math.max(1, Math.ceil(points / most));
}

/**
 * A series drawn in no more than `most` bars: neighbours added together.
 *
 * The filled tile draws its history as bars, and a bar has a width — seven
 * fit, thirty do not, and thirty hair-lines are not a shape anybody reads. A
 * month is therefore drawn two or three days to a bar. ADDED, not averaged:
 * these are takings, and a bar should stand for everything taken in it.
 *
 * Chunks are counted from the END, so when the length does not divide evenly
 * it is the oldest bar that is short. The newest is what the eye lands on,
 * and it should be a whole one.
 */
export function condense(points: number[], most: number = MOST_BARS): number[] {
  if (most < 1 || points.length <= most) return points;

  const each = pointsPerBar(points.length, most);
  const bars: number[] = [];

  for (let end = points.length; end > 0; end -= each) {
    bars.unshift(points.slice(Math.max(0, end - each), end).reduce((sum, value) => sum + value, 0));
  }

  return bars;
}
