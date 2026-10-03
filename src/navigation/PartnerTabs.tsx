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
import { DrawerHost } from "../common/components/DrawerHost";
import { tabsFor, type PartnerTab } from "./tabsFor";
import { DashboardScreen } from "../modules/dashboard/screens/DashboardScreen";
import { OrdersStack } from "./OrdersStack";
import { MenuStack } from "./MenuStack";
import { MoneyStack } from "./MoneyStack";
import { AccountStack } from "./AccountStack";
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
  Dashboard: { label: "Home", icon: GridIcon, screen: DashboardScreen },
  Orders: { label: "Orders", icon: ReceiptIcon, screen: OrdersStack },
  Menu: { label: "Menu", icon: UtensilsIcon, screen: MenuStack },
  Money: { label: "Money", icon: BanknoteIcon, screen: MoneyStack },
  Account: { label: "Account", icon: PersonIcon, screen: AccountStack },
};

/**
 * "Home".
 *
 * It was "Today", on the argument that a tab should say what is on the screen
 * rather than name the software's idea of a page. Changed on the owner's call
 * after seeing the bar on a phone — and "Home" over "Dashboard" because five
 * labels share one row at 12pt, and the longest of them decides whether any
 * of them can be read.
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
            <Icon size={24} color={focused ? c.primaryPressed : c.textMuted} bold={focused} />
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
    /**
     * The drawer wraps the navigator, so it is ONE panel over all five tabs
     * rather than one per screen — and so a link in it can address any tab's
     * stack. See `DrawerHost`.
     */
    <DrawerHost>
      <Tabs.Navigator tabBar={renderTabBar} screenOptions={{ headerShown: false }}>
        {allowed.map((tab) => (
          <Tabs.Screen key={tab} name={tab} component={TABS[tab].screen} />
        ))}
      </Tabs.Navigator>
    </DrawerHost>
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
    /**
     * `primaryPressed`, NOT `primary` — and the palette says so itself.
     *
     * `themes.ts` on the emerald side: *"on the green side a brand-coloured
     * MARK takes `primaryPressed`, and `primary` is for FILLS"*. This bar drew
     * its selected label and icon in `primary`, which measures **2.54:1 on the
     * white bar** — under AA, under AA-large, under the 3:1 floor for a UI
     * component. The most-looked-at text in the app was the least readable
     * thing in it.
     *
     * `primaryPressed` is 5.48:1. Same green family, still unmistakably the
     * selected tab, and legible in a bright shop.
     *
     * Same defect as the button that drew `c.white`: a rule written in the
     * palette and kept by nobody who reads it.
     */
    labelOn: { color: c.primaryPressed, fontWeight: "700" },
    labelOff: { color: c.textMuted, fontWeight: "500" },
  });
