import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@cartze/core/ui/BottomSheet";
import { AppButton } from "@cartze/core/ui/AppButton";
import { ChevronRightIcon } from "@cartze/core/ui/icons";
import { radius, spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { monthGrid, monthTitle, parseYmd, PRESETS, rangeLabel, tapDay, ymd, type DateRange } from "../dateRange";

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * PICK THE DAYS — quick presets on top, a month grid under them.
 *
 * Tap a first day, then a last day; the days between fill in. Future days
 * are greyed out. "Show" applies the range; the sheet keeps what was picked
 * last so re-opening it starts where the person left off.
 */
export function RangeSheet({
  visible,
  initial,
  onClose,
  onApply,
}: {
  visible: boolean;
  initial: DateRange | null;
  onClose: () => void;
  onApply: (r: DateRange) => void;
}) {
  const c = useColors();
  const s = styles(c);
  const now = useMemo(() => new Date(), []);
  const today = ymd(now);
  const [pick, setPick] = useState<{ from: string | null; to: string | null }>({
    from: initial?.from ?? null,
    to: initial?.to ?? null,
  });
  const start = initial ? parseYmd(initial.to) : now;
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });

  const grid = monthGrid(view.y, view.m);
  const atLatest = view.y === now.getFullYear() && view.m === now.getMonth();
  const step = (d: number) => {
    const t = new Date(view.y, view.m + d, 1);
    setView({ y: t.getFullYear(), m: t.getMonth() });
  };
  const ready = !!pick.from;
  const range: DateRange | null = pick.from ? { from: pick.from, to: pick.to ?? pick.from } : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Choose dates"
      footer={
        <AppButton
          title={range ? `Show ${rangeLabel(range)}` : "Pick a day"}
          onPress={() => range && onApply(range)}
          disabled={!ready}
          size="lg"
        />
      }
    >
      <View style={s.body}>
        <View style={s.presets}>
          {PRESETS.map((p) => (
            <Pressable
              key={p.key}
              style={({ pressed }) => [s.preset, pressed && s.pressed]}
              onPress={() => onApply(p.range(now))}
              accessibilityRole="button"
            >
              <Text style={s.presetText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.monthRow}>
          <Pressable onPress={() => step(-1)} hitSlop={10} style={s.navBtn} accessibilityLabel="Previous month">
            <View style={s.flip}>
              <ChevronRightIcon size={18} color={c.text} />
            </View>
          </Pressable>
          <Text style={s.month}>{monthTitle(view.y, view.m)}</Text>
          <Pressable
            onPress={() => !atLatest && step(1)}
            hitSlop={10}
            style={[s.navBtn, atLatest && s.navOff]}
            disabled={atLatest}
            accessibilityLabel="Next month"
          >
            <ChevronRightIcon size={18} color={c.text} />
          </Pressable>
        </View>

        <View style={s.weekRow}>
          {WEEK.map((w, i) => (
            <Text key={i} style={s.weekDay}>
              {w}
            </Text>
          ))}
        </View>
        {grid.map((row, ri) => (
          <View key={ri} style={s.weekRow}>
            {row.map((day, di) => {
              if (!day) return <View key={di} style={s.cell} />;
              const future = day > today;
              const end = pick.to ?? pick.from;
              const edge = day === pick.from || day === end;
              const inside = !!pick.from && !!end && day > pick.from && day < end;
              return (
                <Pressable
                  key={di}
                  style={s.cell}
                  disabled={future}
                  onPress={() => setPick(tapDay(pick, day, today))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: edge || inside, disabled: future }}
                  accessibilityLabel={day}
                >
                  {/* Both fills always drawn, only opacity flips — a fill added on tap loses its radius under Fabric. */}
                  <View style={s.dayFill}>
                    <View pointerEvents="none" style={[s.fill, s.fillInside, inside ? s.on : s.off]} />
                    <View pointerEvents="none" style={[s.fill, s.fillEdge, edge ? s.on : s.off]} />
                    <Text style={[s.dayText, edge && s.dayTextEdge, future && s.dayFuture, day === today && !edge && s.dayToday]}>
                      {parseYmd(day).getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        <Text style={s.hint}>{pick.from && !pick.to ? "Now tap the last day — or Show for one day." : "Tap the first day."}</Text>
      </View>
    </BottomSheet>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
    presets: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
    preset: {
      height: 36,
      paddingHorizontal: spacing.ms,
      borderRadius: 14,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    presetText: { ...typography.label, color: c.primaryPressed, fontSize: 13, lineHeight: 18 },
    pressed: { opacity: 0.8 },
    monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: spacing.xs },
    month: { ...typography.label, color: c.text, fontSize: 16, lineHeight: 22 },
    navBtn: {
      width: 36,
      height: 36,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    navOff: { opacity: 0.35 },
    flip: { transform: [{ scaleX: -1 }] },
    weekRow: { flexDirection: "row" },
    weekDay: { flex: 1, textAlign: "center", ...typography.tiny, color: c.textMuted, fontWeight: "700", paddingVertical: 4 },
    cell: { flex: 1, height: 42, alignItems: "center", justifyContent: "center" },
    dayFill: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
    fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14 },
    fillInside: { backgroundColor: c.primarySoft },
    fillEdge: { backgroundColor: c.primary },
    on: { opacity: 1 },
    off: { opacity: 0 },
    dayText: { ...typography.body, color: c.text },
    dayTextEdge: { color: c.onPrimary, fontWeight: "800" },
    dayFuture: { color: c.textMuted, opacity: 0.4 },
    dayToday: { color: c.primaryPressed, fontWeight: "800" },
    hint: { ...typography.tiny, color: c.textMuted, textAlign: "center", marginTop: spacing.xs },
  });
