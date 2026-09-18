import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BanknoteIcon,
  GridIcon,
  PersonIcon,
  ReceiptIcon,
  UtensilsIcon,
  type IconProps,
} from "@cartze/core/ui/icons";
import { Touchable } from "@cartze/core/ui/Touchable";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useAuthStore } from "../stores/authStore";
import { tabsFor, type PartnerTab } from "./tabsFor";
import { DashboardScreen } from "../modules/dashboard/screens/DashboardScreen";
import { OrdersStack } from "./OrdersStack";
import { MenuScreen } from "../modules/menu/screens/MenuScreen";
import { MoneyScreen } from "../modules/money/screens/MoneyScreen";
import { AccountScreen } from "../modules/account/screens/AccountScreen";
import type { PartnerTabParamList } from "./types";

const Tabs = createBottomTabNavigator<PartnerTabParamList>();

/**
 * ONE TABLE — icon, label and screen for each tab.
 *
 * Read by the bar and by the navigator below it. `tabsFor` decides WHICH of
 * these a person gets; this decides what each one looks like. Two lists would
 * be two places to edit, and this codebase has already paid for that with four
 * guards reading one route list.
 */
const TABS: Record<
  PartnerTab,
  { label: string; icon: (p: IconProps) => React.JSX.Element; screen: React.ComponentType }
> = {
  Dashboard: { label: "Today", icon: GridIcon, screen: DashboardScreen },
  Orders: { label: "Orders", icon: ReceiptIcon, screen: OrdersStack },
  Menu: { label: "Menu", icon: UtensilsIcon, screen: MenuScreen },
  Money: { label: "Money", icon: BanknoteIcon, screen: MoneyScreen },
  Account: { label: "Account", icon: PersonIcon, screen: AccountScreen },
};

/**
 * "Today", not "Dashboard".
 *
 * The tab says what is on the screen — this morning's takings — rather than
 * naming the software's idea of a page. A shopkeeper opening this app at 11am
 * is asking one question, and the label answers it.
 */
function PartnerTabBar({ state, navigation }: BottomTabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const s = styles(c);

  return (
    <View
      style={[
        s.bar,
        {
          // Android's 48-point navigation bar sits under this; without the
          // inset the labels are touched by the system buttons.
          paddingBottom: Math.max(insets.bottom, Platform.OS === "android" ? spacing.sm : 0),
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const item = TABS[route.name as PartnerTab];
        if (!item) return null;
        const Icon = item.icon;

        return (
          <Touchable
            key={route.key}
            onPress={() => {
              if (!focused) navigation.navigate(route.name);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.label}
            style={s.item}
          >
            <Icon size={24} color={focused ? c.primary : c.textMuted} bold={focused} />
            <Text style={[s.label, focused ? s.labelOn : s.labelOff]} numberOfLines={1}>
              {item.label}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}

const renderTabBar = (props: BottomTabBarProps) => <PartnerTabBar {...props} />;

export function PartnerTabs() {
  const user = useAuthStore((s) => s.user);
  const allowed = tabsFor(user);

  return (
    <Tabs.Navigator tabBar={renderTabBar} screenOptions={{ headerShown: false }}>
      {allowed.map((tab) => (
        <Tabs.Screen key={tab} name={tab} component={TABS[tab].screen} />
      ))}
    </Tabs.Navigator>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.sm,
    },
    item: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      paddingVertical: 4,
    },
    /**
     * 12, where the customer app uses 10.5.
     *
     * Different reader, different number. A shopper browses at leisure; a
     * shopkeeper glances at this mid-service, one-handed, often on a cheap
     * screen in a bright shop. Nothing here is small enough to need squinting
     * at, and the bar is tall enough to carry it.
     */
    label: { ...typography.tiny, fontSize: 12 },
    labelOn: { color: c.primary, fontWeight: "700" },
    labelOff: { color: c.textMuted, fontWeight: "500" },
  });
