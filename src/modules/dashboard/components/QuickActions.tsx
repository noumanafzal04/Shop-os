import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Touchable } from "@cartze/core/ui/Touchable";
import { ClockIcon, FileTextIcon, PlusIcon, ReceiptIcon, type Icon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useAuthStore } from "../../../stores/authStore";
import { holds } from "../../../common/permissions";
import { tabsFor } from "../../../navigation/tabsFor";
import { useOrders } from "../../orders/hooks/useOrders";

interface Action {
  key: string;
  label: string;
  icon: Icon;
  badge?: number;
  go: () => void;
}

/**
 * THE FOUR THINGS A SHOP DOES MOST, ONE TAP EACH, ON HOME.
 *
 * "ui thora better kro easy to use ho": the figures tell a shopkeeper how the
 * day is going; these take them where the work is — the order queue (with the
 * waiting count on it), adding a product, the day's sales and the opening
 * hours. Each only when the user's permissions allow its tab, the same rule
 * as the tab bar and the sidebar.
 */
export function QuickActions() {
  const c = useColors();
  const s = styles(c);
  const user = useAuthStore((st) => st.user);
  const nav = useNavigation<{ navigate: (tab: string, params?: object) => void }>();
  const tabs = tabsFor(user);
  const waiting = useOrders({ status: "pending" }, holds(user, "orders.manage")).data?.orders.length ?? 0;
  const canCatalog = holds(user, "products.manage") && user?.tenant?.features?.products === true;

  const actions: Action[] = [];
  if (tabs.includes("Orders")) {
    actions.push({
      key: "orders",
      label: waiting > 0 ? `${waiting} waiting` : "Orders",
      icon: ReceiptIcon,
      badge: waiting,
      go: () => nav.navigate("Orders", { screen: "OrdersQueue" }),
    });
  }
  if (tabs.includes("Menu") && canCatalog) {
    actions.push({ key: "add", label: "Add product", icon: PlusIcon, go: () => nav.navigate("Menu", { screen: "ProductForm" }) });
  }
  if (tabs.includes("Money")) {
    actions.push({ key: "sales", label: "Sales", icon: FileTextIcon, go: () => nav.navigate("Money", { screen: "Sales" }) });
  }
  if (tabs.includes("Account")) {
    actions.push({ key: "hours", label: "Hours", icon: ClockIcon, go: () => nav.navigate("Account", { screen: "Hours" }) });
  }

  if (actions.length === 0) return null;

  return (
    <View style={s.row}>
      {actions.map((a) => {
        const Glyph = a.icon;
        const hot = (a.badge ?? 0) > 0;
        return (
          <Touchable
            key={a.key}
            onPress={a.go}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            style={[s.tile, hot && { borderColor: c.primaryPressed }]}
          >
            <View style={[s.plate, hot && { backgroundColor: c.primary }]}>
              <Glyph size={22} color={hot ? c.onPrimary : c.primaryPressed} />
            </View>
            <Text style={[s.label, hot && { color: c.primaryPressed }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {a.label}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.md },
    tile: {
      flex: 1,
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.ms,
      paddingHorizontal: 4,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    plate: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    label: { ...typography.label, fontSize: 13, lineHeight: 17, color: c.text },
  });
