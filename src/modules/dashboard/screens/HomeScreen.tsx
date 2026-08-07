import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  TrendingUp,
  Receipt,
  Wallet,
  BadgeDollarSign,
  Package,
  ShoppingBag,
  AlertTriangle,
  LogOut,
  Store,
} from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { StatCard, StatCardSkeleton } from "../../../common/ui/StatCard";
import { Card } from "../../../common/ui/Card";
import { colors, radius, spacing, typography } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import { useLogout } from "../../auth/hooks/useAuth";
import { useTenantDashboard } from "../hooks/useDashboard";

const money = (n: number) => `Rs ${n.toLocaleString()}`;

export function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const dashboard = useTenantDashboard();
  const data = dashboard.data;

  return (
    <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => dashboard.refetch()} />}
      >
        {/* Greeting */}
        <View style={styles.header}>
          <View style={styles.logo}>
            <Store size={22} color={colors.white} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Welcome back</Text>
            <Text style={styles.shopName} numberOfLines={1}>
              {user?.tenant?.business_name ?? "Your business"}
            </Text>
          </View>
        </View>

        {/* Subscription banners */}
        {data?.subscription_state === "grace" && (
          <Card style={[styles.banner, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}>
            <Text style={styles.bannerWarn}>
              Subscription in grace period — renew before{" "}
              {data.grace_ends_at ? new Date(data.grace_ends_at).toLocaleDateString() : "soon"}.
            </Text>
          </Card>
        )}
        {data?.subscription_state === "read_only" && (
          <Card style={[styles.banner, { backgroundColor: colors.errorBg, borderColor: colors.error }]}>
            <Text style={styles.bannerErr}>
              Read-only mode: subscription expired. Viewing works; changes unlock after renewal.
            </Text>
          </Card>
        )}

        <Text style={styles.section}>Today</Text>
        <View style={styles.grid}>
          {dashboard.isLoading || !data ? (
            <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
          ) : (
            <>
              <StatCard label="Sales" value={data.today.sales_count} icon={Receipt} hint="transactions" />
              <StatCard label="Revenue" value={money(data.today.revenue)} icon={TrendingUp} tint={colors.success} bg={colors.successBg} />
              <StatCard label="Expenses" value={money(data.today.expenses)} icon={Wallet} tint={colors.warning} bg={colors.warningBg} />
              <StatCard
                label="Profit"
                value={money(data.today.profit)}
                icon={BadgeDollarSign}
                tint={data.today.profit >= 0 ? colors.success : colors.error}
                bg={data.today.profit >= 0 ? colors.successBg : colors.errorBg}
              />
            </>
          )}
        </View>

        <Text style={styles.section}>Overview</Text>
        <View style={styles.grid}>
          {dashboard.isLoading || !data ? (
            <><StatCardSkeleton /><StatCardSkeleton /></>
          ) : (
            <>
              <StatCard label="Products" value={data.products_count} icon={Package}
                hint={data.products_count === 0 ? "Add your first item" : undefined} />
              {data.low_stock_count > 0 ? (
                <StatCard label="Low stock" value={data.low_stock_count} icon={AlertTriangle} tint={colors.warning} bg={colors.warningBg} />
              ) : data.online_shop_enabled ? (
                <StatCard label="Pending orders" value={data.pending_orders} icon={ShoppingBag}
                  hint={`${data.pending_reservations} reservations`} />
              ) : (
                <StatCard label="Low stock" value={0} icon={AlertTriangle} />
              )}
            </>
          )}
        </View>

        <AppButton title="Log out" variant="outline" icon={LogOut} onPress={() => logout.mutate()} loading={logout.isPending} style={styles.logout} />
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.xs, marginBottom: spacing.lg },
  logo: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.brand[500], alignItems: "center", justifyContent: "center" },
  hello: { ...typography.small, color: colors.gray[500] },
  shopName: { ...typography.title, fontSize: 20, color: colors.gray[900] },
  banner: { marginBottom: spacing.md },
  bannerWarn: { color: "#b54708", fontSize: 13 },
  bannerErr: { color: colors.error, fontSize: 13 },
  section: { ...typography.h3, color: colors.gray[900], marginBottom: spacing.sm, marginTop: spacing.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  logout: { marginTop: spacing.sm },
});
