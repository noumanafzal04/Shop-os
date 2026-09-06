import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ArrowUpLeft, Package, Store, Tag } from "lucide-react-native";
import { Touchable } from "../../../common/ui/Touchable";
import { SmartImage } from "../../../common/ui/SmartImage";
import { money } from "../../../common/format";
import { shopInitial, useShopCover } from "../shopCover";
import { spacing, type ThemeColors, typography, useColors } from "../../../theme";
import type { SearchResult } from "../services/marketplaceService";

/**
 * WHAT YOU MEANT, WHILE YOU ARE STILL TYPING.
 *
 * ── The problem with sections ────────────────────────────────────────
 *
 * The search screen answered with three headed blocks — Products, Shops,
 * Categories — which is the right shape for RESULTS somebody has committed to
 * reading. It is the wrong shape for the two seconds while they are still
 * typing, because the thing they are looking for is one row and finding it
 * means reading three headings first.
 *
 * So the top of the screen is a flat, ranked list of the six best matches
 * whatever KIND they are, each one line, each with a mark saying what it is.
 * The sections stay underneath for anyone who wants to browse rather than pick.
 *
 * ── Ranked by the server, presented in the same order ────────────────
 *
 * `/marketplace/search` already scores an exact name match above a prefix
 * above a body match. Re-sorting here would be a second opinion formed with
 * less information — so the order arrives and is kept, interleaved only enough
 * that one kind cannot fill all six slots.
 */

export interface Suggestion {
  key: string;
  kind: "product" | "shop" | "category";
  label: string;
  detail: string | null;
  image: string | null;
  /** Colour for the fallback mark, so a row looks like itself before it loads. */
  seed: string;
  /**
   * WHERE IT OPENS.
   *
   * The shop's slug for a product and for a shop — a product has no page of
   * its own in this app, so both land on the shop that sells it. Null for a
   * category, and null for a product whose shop the search did not return,
   * which is a row that can still fill the box but must not pretend to lead
   * somewhere.
   */
  slug: string | null;
}

/** How many appear. Six is a glance; twelve is a list somebody has to read. */
const LIMIT = 6;

/**
 * The best matches, whatever kind they are.
 *
 * Interleaved rather than concatenated: products first is right most of the
 * time, and a query like "burger" that matches four shops and twenty products
 * would otherwise show no shop at all in six slots.
 */
export function suggestionsFrom(data: SearchResult | undefined): Suggestion[] {
  if (data == null) return [];

  const products: Suggestion[] = data.products.map((p) => ({
    key: `p:${p.id}`,
    kind: "product",
    label: p.name,
    detail: [p.shop?.business_name, money(p.price)].filter(Boolean).join(" · "),
    image: p.image,
    seed: p.id,
    slug: p.shop?.slug ?? null,
  }));

  const shops: Suggestion[] = data.shops.map((s) => ({
    key: `s:${s.slug}`,
    kind: "shop",
    label: s.business_name,
    detail: s.city?.name ?? null,
    image: s.logo_path ?? null,
    seed: s.slug,
    slug: s.slug,
  }));

  const categories: Suggestion[] = data.categories.map((cat) => ({
    key: `c:${cat.name}`,
    kind: "category",
    label: cat.name,
    detail: `${cat.shops_count} shop${cat.shops_count === 1 ? "" : "s"}`,
    image: null,
    seed: cat.name,
    slug: null,
  }));

  // Two products, then a shop, then a product… — a shape that keeps the most
  // likely kind in front without letting it take every slot.
  const out: Suggestion[] = [];
  const queues = [products, shops, categories];
  const take = [2, 1, 1];

  while (out.length < LIMIT && queues.some((q) => q.length > 0)) {
    let moved = false;
    queues.forEach((queue, i) => {
      for (let n = 0; n < take[i] && out.length < LIMIT && queue.length > 0; n++) {
        out.push(queue.shift()!);
        moved = true;
      }
    });
    if (!moved) break;
  }

  return out;
}

interface Props {
  suggestions: Suggestion[];
  onPick: (s: Suggestion) => void;
  /** Puts the term in the box without leaving, for refining rather than picking. */
  onFill: (term: string) => void;
}

export function SearchSuggestions({ suggestions, onPick, onFill }: Props) {
  const c = useColors();
  const coverFor = useShopCover();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  if (suggestions.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {suggestions.map((s) => {
        const cover = coverFor(s.seed);
        const Mark = s.kind === "shop" ? Store : s.kind === "category" ? Tag : Package;

        return (
          <Touchable
            key={s.key}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            onPress={() => onPick(s)}
          >
            {s.kind === "category" ? (
              <View style={styles.mark}>
                <Mark size={17} color={c.primary} strokeWidth={2.2} />
              </View>
            ) : (
              <SmartImage
                uri={s.image}
                fallback={shopInitial(s.label)}
                fallbackBackground={cover.bg}
                fallbackColor={cover.fg}
                style={styles.thumb}
              />
            )}

            <View style={styles.copy}>
              <Text style={styles.label} numberOfLines={1}>
                {s.label}
              </Text>
              {!!s.detail && (
                <Text style={styles.detail} numberOfLines={1}>
                  {s.detail}
                </Text>
              )}
            </View>

            {/*
              PUTS IT IN THE BOX rather than opening it.

              The arrow every search field has, and the one people reach for
              when a suggestion is CLOSE to what they meant — "burger" when
              they wanted "burger bun". Without it, refining means typing the
              whole thing again.
            */}
            <Touchable
              style={styles.fill}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Search for ${s.label}`}
              onPress={() => onFill(s.label)}
            >
              <ArrowUpLeft size={16} color={c.textMuted} strokeWidth={2.2} />
            </Touchable>
          </Touchable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      paddingVertical: 4,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
    },
    thumb: { width: 38, height: 38, borderRadius: 10 },
    mark: {
      width: 38,
      height: 38,
      borderRadius: 10,
      backgroundColor: c.brand[50],
      alignItems: "center",
      justifyContent: "center",
    },
    copy: { flex: 1, gap: 1 },
    label: { ...typography.body, color: c.text, fontSize: 14.5 },
    detail: { ...typography.tiny, color: c.textMuted },
    fill: { padding: 4 },
  });
