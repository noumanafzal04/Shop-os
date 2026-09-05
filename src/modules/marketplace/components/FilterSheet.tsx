import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, SlidersHorizontal, Star } from "lucide-react-native";
import { BottomSheet } from "../../../common/ui/BottomSheet";
import { PriceRange } from "../../../common/ui/PriceRange";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useFacets } from "../hooks/useMarketplace";
import type { BrowseFilters } from "../services/marketplaceService";

/**
 * The filter sheet, and the button that opens it.
 *
 * ── Why the options are fetched and not written down ──────────────────
 *
 * Every chip below is counted from the same query the listing runs, by
 * `/marketplace/products/facets`. A hardcoded rail offers "Bakery" in a city
 * with no bakery and hides a category with forty items in it, and the price
 * slider is the sharpest version of that: fixed 0–10,000 bounds put an entire
 * grocery aisle inside the first eighth of the track, where no two prices can
 * be told apart.
 *
 * ── Draft, then apply ────────────────────────────────────────────────
 *
 * Changing a chip does not re-run the listing — it re-runs the COUNTS, and the
 * button at the bottom says how many results the current draft would give. The
 * listing is behind a dimmed backdrop while the sheet is open, so applying
 * live would be work nobody can see; the number on the button is the part
 * that is actually useful.
 *
 * ── `base` vs `value` ────────────────────────────────────────────────
 *
 * `base` is what the host screen already decided — the search text, or the one
 * shop whose menu this is. The sheet sends it so the counts are right, and
 * never lets Reset clear it: resetting a shop's filters must not silently
 * widen the list to every shop in the country.
 */

const SORTS: Array<{ key: NonNullable<BrowseFilters["sort"]>; label: string }> = [
  // Named for what the server actually does. The default is alphabetical, and
  // calling it "Popular" would be a claim about data nothing here collects.
  { key: "name", label: "A–Z" },
  { key: "price_asc", label: "Price: low first" },
  { key: "price_desc", label: "Price: high first" },
  { key: "discount", label: "Biggest discount" },
  { key: "rating", label: "Top rated" },
  { key: "newest", label: "Newest" },
];

const RATINGS: Array<{ value: number | null; label: string }> = [
  { value: null, label: "Any" },
  { value: 3, label: "3.0+" },
  { value: 4, label: "4.0+" },
  { value: 4.5, label: "4.5+" },
];

/** How many chips a section shows before it offers the rest. */
const COLLAPSED = 10;

const typeLabel = (t: string | null) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Other");

/**
 * How many filters are switched ON — the number on the button's badge.
 *
 * Sort is deliberately not counted: a list is always sorted somehow, so
 * counting it would mean the badge could never read zero.
 */
export function activeFilterCount(f: BrowseFilters): number {
  let n = 0;
  if (f.category) n++;
  if (f.business_type) n++;
  if (f.city_id) n++;
  if (f.size) n++;
  if (f.min_price != null || f.max_price != null) n++;
  if (f.rating_min != null) n++;
  if (f.on_sale) n++;
  if (f.in_stock) n++;
  return n;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** What the host screen already decided. Never cleared by Reset. */
  base?: BrowseFilters;
  value: BrowseFilters;
  onApply: (next: BrowseFilters) => void;
}

export function FilterSheet({ visible, onClose, base = {}, value, onApply }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const [draft, setDraft] = useState<BrowseFilters>(value);
  const [showAllCats, setShowAllCats] = useState(false);

  // Re-seeded each time it opens, not on every render of the host: a sheet
  // that resets its draft while you are using it is a sheet that fights you.
  useEffect(() => {
    if (visible) {
      setDraft(value);
      setShowAllCats(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const query = useMemo(() => ({ ...base, ...draft }), [base, draft]);
  const facets = useFacets(query, { enabled: visible });
  const f = facets.data;

  const set = (patch: Partial<BrowseFilters>) => setDraft((d) => ({ ...d, ...patch }));
  /** A chip that is already on turns itself off — there is no "clear" button per row. */
  const toggle = <K extends keyof BrowseFilters>(key: K, v: BrowseFilters[K]) =>
    set({ [key]: draft[key] === v ? undefined : v } as Partial<BrowseFilters>);

  const active = activeFilterCount(draft);
  const total = f?.total;

  const cats = f?.categories ?? [];
  const shownCats = showAllCats ? cats : cats.slice(0, COLLAPSED);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      action={
        active > 0 ? (
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            onPress={() => setDraft({ sort: draft.sort })}
          >
            <Text style={styles.reset}>Reset</Text>
          </Pressable>
        ) : null
      }
      footer={
        <Pressable
          style={({ pressed }) => [
            styles.apply,
            total === 0 && styles.applyEmpty,
            pressed && styles.applyPressed,
          ]}
          accessibilityRole="button"
          disabled={total === 0}
          onPress={() => {
            onApply(draft);
            onClose();
          }}
        >
          <Text style={[styles.applyText, total === 0 && styles.applyTextEmpty]}>
            {total === undefined
              ? "Show results"
              : total === 0
                ? "Nothing matches — change a filter"
                : `Show ${total} ${total === 1 ? "result" : "results"}`}
          </Text>
        </Pressable>
      }
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Section title="Sort by">
          <View style={styles.chips}>
            {SORTS.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                on={(draft.sort ?? "name") === s.key}
                onPress={() => set({ sort: s.key })}
              />
            ))}
          </View>
        </Section>

        <Section title="Price">
          <PriceRange
            min={f?.price.min ?? 0}
            max={f?.price.max ?? 0}
            value={[draft.min_price ?? null, draft.max_price ?? null]}
            onCommit={(low, high) => set({ min_price: low, max_price: high })}
          />
        </Section>

        {cats.length > 0 && (
          <Section title="Category">
            <View style={styles.chips}>
              {shownCats.map((cat) => (
                <Chip
                  key={cat.name}
                  label={cat.name}
                  count={cat.products_count}
                  on={draft.category === cat.name}
                  onPress={() => toggle("category", cat.name)}
                />
              ))}
              {cats.length > COLLAPSED && (
                <Pressable
                  style={styles.more}
                  accessibilityRole="button"
                  onPress={() => setShowAllCats((v) => !v)}
                >
                  <Text style={styles.moreText}>
                    {showAllCats ? "Show fewer" : `+${cats.length - COLLAPSED} more`}
                  </Text>
                </Pressable>
              )}
            </View>
          </Section>
        )}

        {/* Pinned to one shop already — its type is not a choice. */}
        {!base.shop_slug && (f?.business_types.length ?? 0) > 1 && (
          <Section title="Shop type">
            <View style={styles.chips}>
              {f!.business_types.map((t) => (
                <Chip
                  key={t.type ?? "other"}
                  label={typeLabel(t.type)}
                  count={t.products_count}
                  on={draft.business_type === t.type}
                  onPress={() => toggle("business_type", t.type ?? undefined)}
                />
              ))}
            </View>
          </Section>
        )}

        {(f?.sizes.length ?? 0) > 0 && (
          <Section title="Size">
            <View style={styles.chips}>
              {f!.sizes.slice(0, COLLAPSED).map((s) => (
                <Chip
                  key={s.name}
                  label={s.name}
                  count={s.products_count}
                  on={draft.size === s.name}
                  onPress={() => toggle("size", s.name)}
                />
              ))}
            </View>
          </Section>
        )}

        {!base.shop_slug && (
          <Section title="Shop rating">
            <View style={styles.chips}>
              {RATINGS.map((r) => (
                <Chip
                  key={r.label}
                  label={r.label}
                  icon={r.value !== null}
                  on={(draft.rating_min ?? null) === r.value}
                  onPress={() => set({ rating_min: r.value })}
                />
              ))}
            </View>
          </Section>
        )}

        <Section title="Availability">
          <Toggle
            label="In stock only"
            hint="Hides anything the counter has run out of or switched off"
            on={!!draft.in_stock}
            onPress={() => set({ in_stock: draft.in_stock ? undefined : true })}
          />
          <Toggle
            label="On sale"
            hint={f ? `${f.on_sale_count} reduced right now` : undefined}
            on={!!draft.on_sale}
            onPress={() => set({ on_sale: draft.on_sale ? undefined : true })}
          />
        </Section>
      </ScrollView>
    </BottomSheet>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Chip({
  label,
  count,
  on,
  icon,
  onPress,
}: {
  label: string;
  count?: number;
  on: boolean;
  icon?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable
      style={[styles.chip, on && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
    >
      {icon && <Star size={12} color={on ? c.onPrimary : c.warm} fill={on ? c.onPrimary : c.warm} />}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
      {count !== undefined && (
        <Text style={[styles.chipCount, on && styles.chipCountOn]}>{count}</Text>
      )}
    </Pressable>
  );
}

function Toggle({
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
    <Pressable
      style={styles.toggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
    >
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {!!hint && <Text style={styles.toggleHint}>{hint}</Text>}
      </View>
      <View style={[styles.box, on && styles.boxOn]}>
        {on && <Check size={14} color={c.onPrimary} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

/** The control that opens the sheet, with a badge for how many are on. */
export function FilterButton({
  count,
  onPress,
  tone = "surface",
}: {
  count: number;
  onPress: () => void;
  /** `onBrand` for a button sitting on the hero header's fill. */
  tone?: "surface" | "onBrand";
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const onBrand = tone === "onBrand";
  return (
    <Pressable
      style={[styles.fBtn, onBrand && styles.fBtnOnBrand]}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Filters, ${count} active` : "Filters"}
      onPress={onPress}
    >
      <SlidersHorizontal size={18} color={onBrand ? c.white : c.text} strokeWidth={2.2} />
      {count > 0 && (
        <View style={styles.fBadge}>
          <Text style={styles.fBadgeText}>{count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // flexShrink, not flex: inside a panel with a maxHeight, a ScrollView with
    // no shrink reports its full content height and pushes the footer off.
    scroll: { flexShrink: 1 },
    body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

    section: { marginTop: spacing.md },
    sectionTitle: { ...typography.label, color: c.text, marginBottom: spacing.sm },

    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    chipOn: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { ...typography.small, color: c.textSecondary, fontWeight: "600" },
    chipTextOn: { color: c.onPrimary },
    chipCount: { ...typography.tiny, color: c.textMuted },
    chipCountOn: { color: c.onPrimary, opacity: 0.8 },

    more: { paddingHorizontal: 13, paddingVertical: 9 },
    moreText: { ...typography.small, color: c.primary, fontWeight: "700" },

    toggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: 11,
    },
    toggleCopy: { flex: 1 },
    toggleLabel: { ...typography.body, color: c.text, fontSize: 14.5 },
    toggleHint: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
    box: {
      width: 24,
      height: 24,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    boxOn: { backgroundColor: c.primary, borderColor: c.primary },

    reset: { ...typography.label, color: c.primary, fontSize: 13.5 },

    apply: {
      height: 50,
      borderRadius: radius.md,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    applyPressed: { backgroundColor: c.primaryPressed },
    applyEmpty: { backgroundColor: c.surfaceAlt },
    applyText: { ...typography.label, color: c.onPrimary, fontSize: 15 },
    applyTextEmpty: { color: c.textMuted },

    fBtn: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    fBtnOnBrand: { backgroundColor: "rgba(255,255,255,0.16)", borderColor: "rgba(255,255,255,0.28)" },
    fBadge: {
      position: "absolute",
      top: -5,
      right: -5,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: radius.full,
      backgroundColor: c.warm,
      alignItems: "center",
      justifyContent: "center",
    },
    fBadgeText: { ...typography.tiny, color: c.onWarm, fontWeight: "800", fontSize: 10 },
  });
