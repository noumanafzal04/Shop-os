import React, { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { EmptyState } from "@cartze/core/ui/EmptyState";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { usePullToRefresh } from "@cartze/core/hooks/usePullToRefresh";
import { useDebouncedValue } from "@cartze/core/hooks/useDebouncedValue";
import { toast } from "@cartze/core/ui/toast";
import { ApiError } from "@cartze/core/types/api";
import { SearchIcon, UtensilsIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { ProductRow } from "../components/ProductRow";
import { useCategories, useProducts, useSoldOut } from "../hooks/useCatalog";
import type { MenuStackParamList } from "../../../navigation/types";

/**
 * THE MENU.
 *
 * A list a shopkeeper scans, with the commonest edit on every row. Adding a
 * product, its photo and its category belong to the panel and to the form
 * behind a row — this screen is for the two things that happen during service:
 * finding something, and taking it off.
 */
export function MenuScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation<NativeStackNavigationProp<MenuStackParamList>>();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  /**
   * Typed letters are not a query.
   *
   * 300ms, so a six-letter search is one request rather than six — on a shop's
   * connection the difference is a list that jumps about while somebody is
   * still typing into it.
   */
  const debounced = useDebouncedValue(search, 300);

  const { data, isLoading, isError, refetch } = useProducts({
    ...(debounced.trim() ? { search: debounced.trim() } : {}),
    ...(category ? { category_id: category } : {}),
  });
  const { data: categories } = useCategories();
  const soldOut = useSoldOut();
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const products = data?.products ?? [];

  async function toggle(id: string, currentlyOff: boolean) {
    try {
      await soldOut.mutateAsync({ id, soldOut: !currentlyOff });
    } catch (e) {
      // The optimistic row has already flipped back by now — this says WHY.
      toast.error(e instanceof ApiError ? e.message : "Could not update the menu");
    }
  }

  return (
    <SafeScreen edges={["top"]}>
      <View style={s.head}>
        <Text style={s.title}>Menu</Text>
        <AppTextInput
          icon={SearchIcon}
          placeholder="Search the menu"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {categories && categories.length > 0 ? (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ id: "", name: "All" }, ...categories]}
          keyExtractor={(cat) => cat.id || "all"}
          contentContainerStyle={s.cats}
          renderItem={({ item }) => {
            const on = (item.id || null) === category;
            return (
              <Touchable
                onPress={() => setCategory(item.id || null)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[s.cat, on ? s.catOn : null]}
              >
                <Text style={[s.catText, on ? s.catTextOn : null]} numberOfLines={1}>
                  {item.name}
                </Text>
              </Touchable>
            );
          }}
        />
      ) : null}

      {isLoading && products.length === 0 ? (
        <View style={s.list}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={68} borderRadius={14} />
          ))}
        </View>
      ) : isError && !data ? (
        <View style={s.list}>
          <LoadFailed
            what="your menu"
            onRetry={() => {
              void refetch();
            }}
          />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => p.id}
          contentContainerStyle={[s.list, products.length === 0 ? s.listEmpty : null]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
          }
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              onPress={() => nav.navigate("ProductDetail", { id: item.id })}
              onToggleSoldOut={() => void toggle(item.id, item.sold_out_at !== null)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon={UtensilsIcon}
              tone="muted"
              title={debounced.trim() ? "Nothing matched" : "No items yet"}
              /**
               * The empty state names the FILTER when one is on. An empty list
               * that cannot say why reads as a fact about the shop, and there
               * is no retry on a fact.
               */
              message={
                debounced.trim()
                  ? `Nothing in the menu matches “${debounced.trim()}”.`
                  : category
                    ? "Nothing in this category yet — tap All to see everything."
                    : "Add products from the CartZe web panel and they appear here."
              }
            />
          }
        />
      )}
    </SafeScreen>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    head: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, gap: spacing.sm },
    title: { ...typography.title, color: c.text },
    cats: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    cat: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    catOn: { backgroundColor: c.primary },
    catText: { ...typography.label, fontSize: 13, color: c.textSecondary },
    catTextOn: { color: c.onPrimary },
    list: { padding: spacing.md, paddingTop: spacing.xs, gap: spacing.sm },
    listEmpty: { flexGrow: 1, justifyContent: "center" },
  });
