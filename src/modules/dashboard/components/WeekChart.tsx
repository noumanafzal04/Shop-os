import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { money } from "@cartze/core/format";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import type { SalesPoint } from "../services/dashboardService";

const CHART_HEIGHT = 120;
const GAP = 8;

/**
 * SEVEN DAYS, AS BARS.
 *
 * A bar rather than a line, and that is a readability decision rather than a
 * style one. A shopkeeper is asking "which days were good" — a comparison
 * between seven discrete things, which is what bars are for. A line implies a
 * continuous quantity moving between samples, and Sunday does not flow into
 * Monday.
 *
 * ── The cases that break a chart, all of them real here ──────────────
 *
 * A shop shut all week has seven zeroes, so the tallest bar is 0 and the
 * scale divides by nothing. A brand new shop has one day of takings and six
 * zeroes. A shop that took one large payment has one bar and six slivers.
 * `max` is floored at 1 so the maths holds, and a zero day draws a visible
 * baseline stub rather than nothing — "we were shut" and "there is no data"
 * look identical when both draw nothing, and only one of them is true.
 */
export function WeekChart({ series }: { series: SalesPoint[] }) {
  const c = useColors();
  const s = styles(c);
  const [width, setWidth] = React.useState(0);

  const values = series.map((p) => Math.max(p.revenue, 0));
  const max = Math.max(...values, 1);
  const best = values.indexOf(Math.max(...values));
  const total = values.reduce((a, b) => a + b, 0);

  const barWidth =
    series.length > 0 && width > 0
      ? Math.max((width - GAP * (series.length - 1)) / series.length, 1)
      : 0;

  return (
    <View>
      <View style={s.head}>
        <Text style={s.caption}>Last 7 days</Text>
        <Text style={s.total}>{money(total)}</Text>
      </View>

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            {series.map((point, i) => {
              const value = Math.max(point.revenue, 0);
              // A day with takings is never shorter than 3px, so a small day
              // still reads as a day rather than as a gap.
              const h = value > 0 ? Math.max((value / max) * CHART_HEIGHT, 3) : 2;

              return (
                <Rect
                  key={point.date}
                  x={i * (barWidth + GAP)}
                  y={CHART_HEIGHT - h}
                  width={barWidth}
                  height={h}
                  rx={4}
                  /**
                   * The best day is the brand colour; the rest are a tint of
                   * it. One thing is emphasised and it is the thing somebody
                   * is looking for. A zero day takes the border colour — it is
                   * a rule, not a reading.
                   */
                  fill={value === 0 ? c.border : i === best ? c.primary : c.primarySoft}
                />
              );
            })}
          </Svg>
        ) : (
          <View style={{ height: CHART_HEIGHT }} />
        )}
      </View>

      <View style={s.axis}>
        {series.map((point, i) => (
          <Text
            key={point.date}
            style={[s.day, i === best && total > 0 ? s.dayBest : null]}
            numberOfLines={1}
          >
            {point.day}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    head: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginBottom: spacing.md,
    },
    caption: { ...typography.label, color: c.textSecondary },
    total: { ...typography.h3, color: c.text },
    axis: { flexDirection: "row", marginTop: spacing.sm },
    day: {
      ...typography.small,
      flex: 1,
      textAlign: "center",
      color: c.textMuted,
    },
    /**
     * The best day is named in BOTH the bar and the label.
     *
     * Colour alone would leave the chart unreadable to somebody who cannot
     * separate the brand hue from its own tint — which, on the green palette,
     * measures 2.41:1 between exactly those two.
     */
    dayBest: { color: c.primaryPressed, fontWeight: "700" },
  });
