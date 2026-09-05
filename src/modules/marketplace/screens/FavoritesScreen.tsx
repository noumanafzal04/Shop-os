import React from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { AppButton } from "../../../common/ui/AppButton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useFavorites } from "../hooks/useMarketplace";
import { useLogout } from "../../auth/hooks/useAuth";
import { useAuthStore } from "../../../stores/authStore";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";

/**
 * Customer's favorite shops + account actions.
 */
export function FavoritesScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const favorites = useFavorites(true);
  const pull = usePullToRefresh(favorites.refetch);
  const logout = useLogout();

  const rows = favorites.data ?? [];

  return (
    <SafeScreen backgroundColor={c.gray[50]}>
      <ScreenHeader title="Favourites" subtitle={user?.name} />

      {favorites.isLoading ? (
        <View style={styles.list}>
          <SkeletonListRow />
          <SkeletonListRow />
          <SkeletonListRow />
        </View>
      ) : favorites.isError ? (
        <LoadFailed
          what="your saved shops"
          error={favorites.error}
          onRetry={() => favorites.refetch()}
          retrying={favorites.isFetching}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.slug}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => navigation.navigate("MarketShop", { slug: item.slug })}
            >
              <View style={styles.logoBox}>
                <Text style={styles.logoLetter}>{item.business_name.charAt(0)}</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={1}>{item.business_name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.business_category ?? item.business_type}
                  {item.city ? ` · ${item.city.name}` : ""}
                </Text>
              </View>
              <Text style={styles.heart}>♥</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No favorites yet</Text>
              <Text style={styles.emptyText}>
                Browse the market and tap ♡ on shops you love.
              </Text>
            </View>
          }
          ListFooterComponent={
            <AppButton
              title="Log out"
              variant="outline"
              onPress={() => logout.mutate()}
              loading={logout.isPending}
              style={{ marginTop: spacing.lg }}
            />
          }
        />
      )}
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  header: { padding: spacing.md },
  title: { ...typography.title, fontSize: 22, color: c.gray[900] },
  sub: { ...typography.small, color: c.gray[500], marginTop: 2 },
  list: { padding: spacing.md, paddingTop: 0 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.brand[50],
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  logoLetter: { fontSize: 20, fontWeight: "700", color: c.brand[500] },
  info: { flex: 1 },
  name: { ...typography.label, fontSize: 15, color: c.gray[900] },
  meta: { ...typography.small, color: c.gray[500], marginTop: 2, textTransform: "capitalize" },
  heart: { fontSize: 18, color: c.brand[500] },
  empty: { alignItems: "center", paddingVertical: spacing.xl * 2 },
  emptyTitle: { ...typography.label, color: c.gray[700] },
  emptyText: { ...typography.small, color: c.gray[500], marginTop: spacing.xs },
});
