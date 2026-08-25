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
