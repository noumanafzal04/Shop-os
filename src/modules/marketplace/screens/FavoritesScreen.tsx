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
import { SkeletonCard } from "../../../common/ui/Skeleton";
import { AppButton } from "../../../common/ui/AppButton";
import { colors, radius, spacing, typography } from "../../../theme";
import { useFavorites } from "../hooks/useMarketplace";
import { useLogout } from "../../auth/hooks/useAuth";
import { useAuthStore } from "../../../stores/authStore";

/**
 * Customer's favorite shops + account actions.
 */
export function FavoritesScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const favorites = useFavorites(true);
  const logout = useLogout();

  const rows = favorites.data ?? [];

  return (
    <SafeScreen backgroundColor={colors.gray[50]} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Favorites</Text>
          <Text style={styles.sub}>{user?.name}</Text>
        </View>
      </View>

      {favorites.isLoading ? (
        <View style={styles.list}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.slug}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={favorites.isRefetching}
              onRefresh={() => favorites.refetch()}
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

const styles = StyleSheet.create({
  header: { padding: spacing.md },
  title: { ...typography.title, fontSize: 22, color: colors.gray[900] },
  sub: { ...typography.small, color: colors.gray[500], marginTop: 2 },
  list: { padding: spacing.md, paddingTop: 0 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  logoLetter: { fontSize: 20, fontWeight: "700", color: colors.brand[500] },
  info: { flex: 1 },
  name: { ...typography.label, fontSize: 15, color: colors.gray[900] },
  meta: { ...typography.small, color: colors.gray[500], marginTop: 2, textTransform: "capitalize" },
  heart: { fontSize: 18, color: colors.brand[500] },
  empty: { alignItems: "center", paddingVertical: spacing.xl * 2 },
  emptyTitle: { ...typography.label, color: colors.gray[700] },
  emptyText: { ...typography.small, color: colors.gray[500], marginTop: spacing.xs },
});
