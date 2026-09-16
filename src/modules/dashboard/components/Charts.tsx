/**
 * STUB — structure only.
 *
 * Two charts, and no chart library.
 *
 *   LINE    seven days of revenue — `sales_series`, already zero-filled
 *   DONUT   this month's spend per category — `expense_breakdown`
 *
 * ── Why hand-drawn in react-native-svg ───────────────────────────────
 *
 * The app already ships `react-native-svg` for its icons. A charting
 * package would be a second native dependency, a second upgrade path
 * across two apps, and megabytes for two shapes. Seven points and a ring
 * are arithmetic.
 *
 * ── What a chart must not do ─────────────────────────────────────────
 *
 * Interpolate. A day with no sales is a REAL zero — the server zero-fills
 * for exactly this reason — and a smooth curve through it draws revenue
 * on a day the shop was shut.
 *
 * Axis labels are the shop's own currency, PKR. Never a "$".
 */
