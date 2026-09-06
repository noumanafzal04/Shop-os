import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, ChevronDown, SlidersHorizontal, Star, Tag } from "lucide-react-native";
import { Touchable } from "../../../common/ui/Touchable";
import { BottomSheet } from "../../../common/ui/BottomSheet";
import { spacing, type ThemeColors, typography, useColors } from "../../../theme";
import type { BrowseFilters } from "../services/marketplaceService";

/**
 * THE FILTERS WORTH REACHING WITHOUT OPENING ANYTHING.
 *
 * ── What this is for ─────────────────────────────────────────────────
 *
 * The aisle had one control: a Filter button that opened a full sheet. Every
 * question, however small, cost the same — open a sheet, find the row, tick
 * it, press Show. "Only things on sale" is one tap's worth of intent and was
 * costing four.
 *
 * So the four questions people actually ask sit on a bar under the header, and
 * the sheet keeps everything else. That split is the point: this is not a
 * second filter UI, it is the shortcut to the same state, and pressing a pill
 * writes the identical `BrowseFilters` the sheet would have written.
 *
 * ── Two shapes of pill, and the difference is honest ─────────────────
 *
 * A TOGGLE turns itself on and off — on sale, in stock, well rated. It carries
 * no chevron because nothing opens.
 *
 * A CHOICE opens a small sheet and carries a chevron, because a chevron that
 * does not open something is a lie people only fall for once. Sort is the only
 * one today; price stays in the full sheet, where the slider lives.
 */

const SORTS: Array<{ key: NonNullable<BrowseFilters["sort"]>; label: string }> = [
  // The same list, in the same words, as the sheet. Named for what the server
  // does — "Popular" would be a claim about data nothing here collects.
  { key: "name", label: "A–Z" },
  { key: "price_asc", label: "Price: low first" },
  { key: "price_desc", label: "Price: high first" },
  { key: "discount", label: "Biggest discount" },
  { key: "rating", label: "Top rated" },
  { key: "newest", label: "Newest" },
];

interface Props {
  filters: BrowseFilters;
  onChange: (next: BrowseFilters) => void;
  /** Opens the full sheet — everything this bar deliberately leaves out. */
  onOpenAll: () => void;
  /** How many filters are on, for the badge on the All button. */
  activeCount: number;
}

export function QuickFilters({ filters, onChange, onOpenAll, activeCount }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const [sortOpen, setSortOpen] = React.useState(false);

  const sortLabel = SORTS.find((s) => s.key === filters.sort)?.label ?? "Sort";
  const toggle = (patch: BrowseFilters) => onChange({ ...filters, ...patch });

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bar}
      >
        {/*
          ALL FILTERS FIRST, and it is the widest.

          It is the way to everything this bar does not cover, so it belongs
          where a thumb lands rather than at the end of a scroll somebody has
          to discover.
        */}
        <Touchable
          style={[styles.pill, styles.allPill, activeCount > 0 && styles.pillOn]}
          accessibilityRole="button"
          accessibilityLabel={activeCount > 0 ? `Filters, ${activeCount} on` : "All filters"}
          onPress={onOpenAll}
        >
          <SlidersHorizontal
            size={14}
            color={activeCount > 0 ? c.onPrimary : c.text}
            strokeWidth={2.4}
          />
          <Text style={[styles.pillText, activeCount > 0 && styles.pillTextOn]}>Filters</Text>
          {activeCount > 0 && (
            <View style={styles.count}>
              <Text style={styles.countText}>{activeCount}</Text>
            </View>
          )}
        </Touchable>

        <Pill
          label={sortLabel}
          on={filters.sort != null}
          chevron
          onPress={() => setSortOpen(true)}
        />

        <Pill
          label="On sale"
          icon={Tag}
          on={!!filters.on_sale}
          onPress={() => toggle({ on_sale: filters.on_sale ? undefined : true })}
        />

        <Pill
          label="4★ and up"
          icon={Star}
          on={filters.rating_min === 4}
          // Four is the number people mean by "well rated" — five is a filter
          // that returns three shops, and three is not a filter.
          onPress={() => toggle({ rating_min: filters.rating_min === 4 ? null : 4 })}
        />

        <Pill
          label="In stock"
          on={!!filters.in_stock}
          onPress={() => toggle({ in_stock: filters.in_stock ? undefined : true })}
        />
      </ScrollView>

      {/*
        A sheet for the one CHOICE on the bar. Small on purpose: six lines and
        a tick, not the full filter panel wearing a different hat.
      */}
      <BottomSheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        <View style={styles.sortList}>
          {SORTS.map((s) => {
            const on = filters.sort === s.key;
            return (
              <Touchable
                key={s.key}
                style={styles.sortRow}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  // Pressing the one already on CLEARS it, so the bar can get
                  // back to the server's own order without a "None" row that
                  // means the same thing.
                  onChange({ ...filters, sort: on ? undefined : s.key });
                  setSortOpen(false);
                }}
              >
                <Text style={[styles.sortText, on && styles.sortTextOn]}>{s.label}</Text>
                {on && <Check size={17} color={c.primary} strokeWidth={2.6} />}
              </Touchable>
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}

function Pill({
  label,
  icon: Icon,
  on,
  chevron,
  onPress,
}: {
  label: string;
  icon?: typeof Tag;
  on: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  return (
    <Touchable
      style={[styles.pill, on && styles.pillOn]}
      scaleTo={0.94}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
    >
      {Icon != null && <Icon size={13} color={on ? c.onPrimary : c.textSecondary} strokeWidth={2.4} />}
      <Text style={[styles.pillText, on && styles.pillTextOn]} numberOfLines={1}>
        {label}
      </Text>
      {chevron && (
        <ChevronDown size={13} color={on ? c.onPrimary : c.textMuted} strokeWidth={2.6} />
      )}
    </Touchable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      // An explicit number, not `radius.full`: a very large radius renders as
      // a square on small views under the new architecture.
      borderRadius: 17,
      paddingHorizontal: 12,
      height: 34,
    },
    allPill: { borderColor: c.gray[300] },
    pillOn: { backgroundColor: c.primary, borderColor: c.primary },
    pillText: { ...typography.small, color: c.text, fontWeight: "600", fontSize: 12.5 },
    pillTextOn: { color: c.onPrimary },

    count: {
      minWidth: 17,
      height: 17,
      borderRadius: 9,
      backgroundColor: c.onPrimary,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
    },
    countText: { ...typography.tiny, color: c.primary, fontWeight: "800", fontSize: 10 },

    sortList: { paddingBottom: spacing.md },
    sortRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 13,
      paddingHorizontal: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    sortText: { ...typography.body, color: c.text, fontSize: 15 },
    sortTextOn: { color: c.primary, fontWeight: "700" },
  });
