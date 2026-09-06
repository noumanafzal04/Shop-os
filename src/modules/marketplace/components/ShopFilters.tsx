import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { ClockIcon, MotorcycleIcon, StarIcon } from "../../../common/ui/icons";
import { Touchable } from "../../../common/ui/Touchable";
import { spacing, type ThemeColors, typography, useColors } from "../../../theme";
import type { ShopQuery } from "../services/marketplaceService";

/**
 * THREE QUESTIONS ABOUT A SHOP, ON A LIST OF SHOPS.
 *
 * ── Where these belong ───────────────────────────────────────────────
 *
 * "Open now" and "Free delivery" went to the product aisle first, because
 * that is where filters were asked for. They belong HERE more: the aisle is a
 * list of things, this is a list of shops, and "is it open" is a question
 * about a shop. Somebody on the Grocery tab at nine in the evening was reading
 * a page of names, half of them shut, with no way to say so.
 *
 * ── Why this is not `QuickFilters` ───────────────────────────────────
 *
 * That bar writes a `BrowseFilters`, which carries a size, a price range and a
 * sale — none of which a SHOP has. Sharing the component would mean either a
 * union type at every call site or a bar offering controls with nothing behind
 * them, and a control with nothing behind it is the thing this app keeps
 * finding and deleting.
 *
 * What IS shared is the vocabulary: `open_now`, `free_delivery`, `rating_min`
 * mean the same thing in both, so a choice made here could be carried into the
 * aisle without translating it.
 */

interface Props {
  value: ShopQuery;
  onChange: (next: ShopQuery) => void;
}

export function ShopFilters({ value, onChange }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const set = (patch: ShopQuery) => onChange({ ...value, ...patch });

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bar}>
      <Pill
        label="Open now"
        icon={ClockIcon}
        on={!!value.open_now}
        onPress={() => set({ open_now: value.open_now ? undefined : true })}
      />
      <Pill
        label="Free delivery"
        icon={MotorcycleIcon}
        on={!!value.free_delivery}
        onPress={() => set({ free_delivery: value.free_delivery ? undefined : true })}
      />
      <Pill
        label="4★ and up"
        icon={StarIcon}
        on={value.rating_min === 4}
        // Four is what people mean by "well rated". Five returns three shops,
        // and three is not a filter.
        onPress={() => set({ rating_min: value.rating_min === 4 ? null : 4 })}
      />
      <Pill
        label="Top rated first"
        on={value.sort === "rating"}
        // A SORT among filters, and it is the one people reach for on a list
        // of shops. Pressing it again clears it, so the list can get back to
        // the server's own order — nearest, when a pin is known.
        onPress={() => set({ sort: value.sort === "rating" ? undefined : "rating" })}
      />
    </ScrollView>
  );
}

function Pill({
  label,
  icon: Icon,
  on,
  onPress,
}: {
  label: string;
  icon?: typeof ClockIcon;
  on: boolean;
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
      {Icon != null && <Icon size={13} color={on ? c.onPrimary : c.textSecondary} />}
      <Text style={[styles.pillText, on && styles.pillTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    bar: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
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
    pillOn: { backgroundColor: c.primary, borderColor: c.primary },
    pillText: { ...typography.small, color: c.text, fontWeight: "600", fontSize: 12.5 },
    pillTextOn: { color: c.onPrimary },
  });
