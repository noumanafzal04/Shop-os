import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "../../../common/ui/BottomSheet";
import { Touchable } from "../../../common/ui/Touchable";
import { AppButton } from "../../../common/ui/AppButton";
import { CheckIcon } from "../../../common/ui/icons";
import { useCities } from "../hooks/useMarketplace";
import { spacing, type ThemeColors, typography, useColors } from "../../../theme";
import type { ShopQuery } from "../services/marketplaceService";

/**
 * EVERYTHING THE PILL BAR DELIBERATELY LEAVES OUT.
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

export function ShopFilterSheet({ visible, onClose, value, onApply }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const [draft, setDraft] = React.useState<ShopQuery>(value);
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

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
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
      <View style={styles.body}>
        {/* ── City ─────────────────────────────────────────────── */}
        <Text style={styles.section}>City</Text>
        <View style={styles.rows}>
          <Row
            label="Anywhere"
            on={!draft.city_id}
            onPress={() => set({ city_id: undefined })}
          />
          {(cities.data ?? []).map((city) => (
            <Row
              key={city.id}
              label={city.name}
              hint={`${city.shops_count} shop${city.shops_count === 1 ? "" : "s"}`}
              on={draft.city_id === city.id}
              onPress={() => set({ city_id: draft.city_id === city.id ? undefined : city.id })}
            />
          ))}
        </View>

        {/* ── How far ──────────────────────────────────────────── */}
        <Text style={styles.section}>How far</Text>
        <View style={styles.rows}>
          <Row label="Any distance" on={!draft.radius} onPress={() => set({ radius: undefined })} />
          {RADIUS.map((km) => (
            <Row
              key={km}
              label={`Within ${km} km`}
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
      </View>
    </BottomSheet>
  );
}

function Row({
  label,
  hint,
  on,
  onPress,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  return (
    <Touchable
      style={styles.row}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
    >
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{label}</Text>
        {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      {on && <CheckIcon size={17} color={c.primary} />}
    </Touchable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    section: {
      ...typography.label,
      color: c.text,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      fontSize: 14,
    },
    rows: { borderRadius: 14, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      backgroundColor: c.surface,
    },
    rowCopy: { flex: 1, gap: 1 },
    rowLabel: { ...typography.body, color: c.text, fontSize: 14.5 },
    rowLabelOn: { color: c.primary, fontWeight: "700" },
    rowHint: { ...typography.tiny, color: c.textMuted },
    reset: { ...typography.label, color: c.primary, fontSize: 13.5 },
    note: { ...typography.tiny, color: c.textMuted, marginTop: spacing.sm, lineHeight: 16 },
  });
