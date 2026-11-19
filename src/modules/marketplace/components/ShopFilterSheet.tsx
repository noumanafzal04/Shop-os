import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "../../../common/ui/BottomSheet";
import { Touchable } from "../../../common/ui/Touchable";
import { AppButton } from "../../../common/ui/AppButton";
import { ClockIcon, MotorcycleIcon, StarIcon } from "../../../common/ui/icons";
import { useCities } from "../hooks/useMarketplace";
import { spacing, type ThemeColors, typography, useColors } from "../../../theme";
import type { ShopQuery } from "../services/marketplaceService";

/**
 * EVERYTHING THE PILL BAR DELIBERATELY LEAVES OUT — and the bar's own
 * toggles again, so the sheet is the one place a shopper sees every filter.
 *
 * ── The look (USER 2026-11-19: "filter screen b") ────────────────────
 *
 * It was two bordered lists with a tick — City, then How far — that read as a
 * settings page. Now it is the delivery apps' filter sheet: Sort by as radio
 * rows, the yes/no filters as chips, distance as chips, the city list last
 * (the longest, and the one most people never change), trimmed to six with a
 * "Show all".
 *
 * ── What belongs in a sheet and what does not ────────────────────────
 *
 * A pill is for a question with one answer: open, free delivery, four stars.
 * A CITY has forty answers and a distance has a scale, and neither fits on a
 * bar somebody scrolls sideways.
 *
 * That is the same split the aisle already uses — its bar carries the toggles
 * and its sheet carries the price slider and the category list. One rule, two
 * screens, so a shopper who has met one has met the other.
 *
 * ── A draft, applied on Show ─────────────────────────────────────────
 *
 * Every change here refetches a list somebody is not looking at. Editing a
 * draft and applying once means one request instead of five, and — more to the
 * point — it means Cancel is possible. A sheet that writes straight through
 * has no way back from a filter somebody was only trying out.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  value: ShopQuery;
  onApply: (next: ShopQuery) => void;
}

/** The distances worth offering. Beyond ten, a bike is not coming. */
const RADIUS = [2, 5, 10] as const;

/** Cities shown before "Show all" — most shoppers never change theirs. */
export const CITIES_SHOWN = 6;

export function ShopFilterSheet({ visible, onClose, value, onApply }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const [draft, setDraft] = React.useState<ShopQuery>(value);
  const [allCities, setAllCities] = React.useState(false);
  const cities = useCities("");

  // Re-seeded each time it OPENS, not on every render: a draft that follows
  // the applied value would discard an edit the moment the list refetched.
  React.useEffect(() => {
    if (visible) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const set = (patch: ShopQuery) => setDraft((d) => ({ ...d, ...patch }));

  const apply = () => {
    onApply(draft);
    onClose();
  };

  const cityList = citiesToShow(cities.data ?? [], draft.city_id, allCities);
  const hidden = (cities.data?.length ?? 0) - cityList.length;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      // It scrolls (four sections and a city list outgrow a phone), so the
      // drag is the handle's alone — the same choice as the aisle's sheet.
      dragHandleOnly
      title="Filters"
      action={
        <Touchable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          onPress={() => setDraft({})}
        >
          <Text style={styles.reset}>Reset</Text>
        </Touchable>
      }
      footer={<AppButton title="Show shops" onPress={apply} />}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        {/* ── Sort by ──────────────────────────────────────────── */}
        <Text style={styles.section}>Sort by</Text>
        <View style={styles.card}>
          <Radio label="Nearest first" on={draft.sort !== "rating"} onPress={() => set({ sort: undefined })} />
          <Radio label="Top rated" on={draft.sort === "rating"} onPress={() => set({ sort: "rating" })} last />
        </View>

        {/* ── Yes/no filters — the bar's pills, again ──────────── */}
        <Text style={styles.section}>Quick filters</Text>
        <View style={styles.chips}>
          <Chip
            label="Open now"
            icon={ClockIcon}
            on={!!draft.open_now}
            onPress={() => set({ open_now: draft.open_now ? undefined : true })}
          />
          <Chip
            label="Free delivery"
            icon={MotorcycleIcon}
            on={!!draft.free_delivery}
            onPress={() => set({ free_delivery: draft.free_delivery ? undefined : true })}
          />
          <Chip
            label="4★ and up"
            icon={StarIcon}
            on={draft.rating_min === 4}
            onPress={() => set({ rating_min: draft.rating_min === 4 ? null : 4 })}
          />
        </View>

        {/* ── How far ──────────────────────────────────────────── */}
        <Text style={styles.section}>Distance</Text>
        <View style={styles.chips}>
          <Chip label="Any" on={!draft.radius} onPress={() => set({ radius: undefined })} />
          {RADIUS.map((km) => (
            <Chip
              key={km}
              label={`${km} km`}
              a11y={`Within ${km} km`}
              on={draft.radius === km}
              onPress={() => set({ radius: draft.radius === km ? undefined : km })}
            />
          ))}
        </View>
        {/*
          The server sorts by distance only when it has been given a pin, so a
          distance filter on a phone that has not shared its location would
          silently do nothing. Saying so beats a control that looks broken.
        */}
        <Text style={styles.note}>
          Distance needs your location. Set it from the home screen if the list does not change.
        </Text>

        {/* ── City ─────────────────────────────────────────────── */}
        <Text style={styles.section}>City</Text>
        <View style={styles.card}>
          <Radio
            label="Anywhere"
            on={!draft.city_id}
            onPress={() => set({ city_id: undefined })}
            last={cityList.length === 0 && hidden <= 0}
          />
          {cityList.map((city, i) => (
            <Radio
              key={city.id}
              label={city.name}
              hint={`${city.shops_count} shop${city.shops_count === 1 ? "" : "s"}`}
              on={draft.city_id === city.id}
              onPress={() => set({ city_id: draft.city_id === city.id ? undefined : city.id })}
              last={i === cityList.length - 1 && hidden <= 0}
            />
          ))}
          {hidden > 0 && (
            <Touchable
              style={styles.more}
              accessibilityRole="button"
              accessibilityLabel={`Show all ${cities.data?.length ?? 0} cities`}
              onPress={() => setAllCities(true)}
            >
              <Text style={styles.moreText}>Show all {cities.data?.length ?? 0} cities</Text>
            </Touchable>
          )}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

/**
 * The first few cities — and ALWAYS the one picked, even when it sits past
 * the cut: a selection the shopper cannot see is a filter they cannot undo.
 */
export function citiesToShow<T extends { id: string }>(all: T[], picked: string | undefined, showAll: boolean): T[] {
  if (showAll || all.length <= CITIES_SHOWN) return all;
  const first = all.slice(0, CITIES_SHOWN);
  const chosen = picked ? all.find((x) => x.id === picked) : undefined;
  return chosen && !first.includes(chosen) ? [...first, chosen] : first;
}

function Radio({
  label,
  hint,
  on,
  onPress,
  last,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  return (
    <Touchable
      style={[styles.row, last && styles.rowLast]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
    >
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{label}</Text>
        {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      <View style={[styles.ring, on && styles.ringOn]}>{on && <View style={styles.dot} />}</View>
    </Touchable>
  );
}

function Chip({
  label,
  a11y,
  icon: Icon,
  on,
  onPress,
}: {
  label: string;
  a11y?: string;
  icon?: typeof ClockIcon;
  on: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  return (
    <Touchable
      style={[styles.chip, on && styles.chipOn]}
      scaleTo={0.95}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={a11y ?? label}
      onPress={onPress}
    >
      {Icon != null && <Icon size={15} color={on ? c.primary : c.textSecondary} />}
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // flexShrink, not flex: a ScrollView with no shrink inside a panel with a
    // maxHeight reports its whole content and pushed "Show shops" under the
    // phone's own buttons.
    scroll: { flexShrink: 1 },
    body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    section: {
      ...typography.label,
      color: c.text,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "700",
    },
    card: { borderRadius: 16, borderWidth: 1, borderColor: c.border, overflow: "hidden", backgroundColor: c.surface },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      paddingHorizontal: 14,
      minHeight: 52,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowLast: { borderBottomWidth: 0 },
    rowCopy: { flex: 1, gap: 1 },
    rowLabel: { ...typography.body, color: c.text, fontSize: 15, lineHeight: 22 },
    rowLabelOn: { fontWeight: "700" },
    rowHint: { ...typography.tiny, color: c.textMuted },
    // 9, not 10: a radius of exactly half the size renders SQUARE under Fabric.
    ring: {
      width: 20,
      height: 20,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: c.gray[300],
      alignItems: "center",
      justifyContent: "center",
    },
    ringOn: { borderColor: c.primary },
    dot: { width: 10, height: 10, borderRadius: 4.5, backgroundColor: c.primary },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 40,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    chipOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
    chipText: { ...typography.small, color: c.text, fontWeight: "600", fontSize: 14, lineHeight: 18 },
    chipTextOn: { color: c.primary },
    more: { paddingHorizontal: 14, paddingVertical: 14 },
    moreText: { ...typography.label, color: c.primary, fontSize: 14, lineHeight: 18 },
    reset: { ...typography.label, color: c.primary, fontSize: 14, lineHeight: 18 },
    note: { ...typography.tiny, color: c.textMuted, marginTop: spacing.sm, lineHeight: 16 },
  });
