import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import {
  CircleUserRound,
  ReceiptText,
  Search,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme } from "../theme";
import { tradeIcon } from "../modules/marketplace/tradeIcon";
import { cartCountOf, useCartStore } from "../stores/cartStore";

/**
 * The bottom navigation.
 *
 * ── What this is ──────────────────────────────────────────────────────
 *
 * A white bar across the foot of the screen with a rounded top edge, five
 * labelled slots, and the basket as a filled brand disc in the middle.
 *
 * ── The three versions before it, and what each one got wrong ─────────
 *
 * 1. A full-width white strip with the basket pushed half out of its top. The
 *    disc cut a bite out of the bar's own border and its ring read as a hole.
 *
 * 2. A floating dark pill. It fixed the hole and introduced a grey plate: a
 *    hairline border invisible on ink and visible on the page, plus `elevation`
 *    casting a halo onto a near-white background.
 *
 * 3. The same pill with the selected tab's caption inside a widened slot. That
 *    moved every other icon each time you changed tabs.
 *
 * The rule those three cost: NOTHING IN THIS BAR MAY CHANGE SIZE. Every slot
 * is `flex: 1` and every state is a change of colour or fill inside a box that
 * keeps its dimensions.
 *
 * ── Why white, in the end ─────────────────────────────────────────────
 *
 * Ink separated the bar from the page without a border, which is what it was
 * chosen for, and it kept reading as a slab laid on top of the app rather than
 * as part of it. White with a hairline and a rounded top edge belongs to the
 * page — and the basket, the one thing that should be loud, has the whole of
 * the brand colour to itself against it.
 */

interface Item {
  route: string;
  label: string;
  icon: LucideIcon;
}

const ITEMS: Record<string, Item> = {
  // Read from the ONE trade-icon map, not a second copy of it — that copy
  // is how this tab kept the crossed-utensils glyph after the trade chips
  // were moved off it.
  FoodTab: { route: "FoodTab", label: "Food", icon: tradeIcon("food") },
  // A basket, deliberately not a trolley: the middle button is a trolley and
  // two of them in one bar is two words for different things.
  GroceryTab: { route: "GroceryTab", label: "Grocery", icon: tradeIcon("mart") },
  OrdersTab: { route: "OrdersTab", label: "Orders", icon: ReceiptText },
  AccountTab: { route: "AccountTab", label: "Account", icon: CircleUserRound },
  SearchTab: { route: "SearchTab", label: "Search", icon: Search },
};

export function AppTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { colors: c, typography } = useTheme();
  const count = useCartStore((s) => cartCountOf(s.lines));

  const go = (routeName: string, index: number) => {
    const focused = state.index === index;
    const event = navigation.emit({
      type: "tabPress",
      target: state.routes[index].key,
      canPreventDefault: true,
    });
    if (!focused && !event.defaultPrevented) navigation.navigate(routeName);
  };

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          /**
           * The navigator's OWN measurement, not `useSafeAreaInsets()`.
           *
           * React Navigation renders a custom tab bar inside a context whose
           * bottom inset is ZERO — the navigator treats the inset as its to
           * spend and hands it to the bar as a prop. So the hook, which is
           * correct on every other screen in this app, returned 0 here and
           * `Math.max(0, 8)` gave the bar eight points of padding under a
           * 48-point navigation bar: the labels touched the buttons and the
           * basket disc was cut in half.
           *
           * Nothing looked wrong on a gesture-navigation emulator, where the
           * inset is small enough that 8 nearly covers it.
           */
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const isCart = route.name === "CartTab";
        const item = ITEMS[route.name];

        if (isCart) {
          return (
            <Pressable
              key={route.key}
              onPress={() => go(route.name, index)}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={count > 0 ? `Basket, ${count} items` : "Basket"}
              style={styles.slot}
            >
              {/*
                In the bar, not out of it. The raised version needed a thick
                ring in the page's colour to stop it reading as a hole punched
                through the bar — and a button that needs a cut-out around it
                to be legible is a button fighting its own container.
              */}
              {/*
                The badge is positioned against the DISC, not the slot.

                Anchored to the slot it measured from the slot's edge — a fifth
                of a 178px column away from a 48px circle — so it floated in
                open space beside the button it was counting.
              */}
              <View style={styles.discWrap}>
                <View style={[styles.disc, { backgroundColor: c.primary }]}>
                  <ShoppingCart size={23} color={c.onPrimary} strokeWidth={2.4} />
                </View>
                {count > 0 && (
                  <View style={[styles.badge, { backgroundColor: c.warm, borderColor: c.surface }]}>
                    <Text style={[styles.badgeText, { color: c.onWarm }]}>
                      {count > 99 ? "99+" : count}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }

        if (!item) return <View key={route.key} style={styles.slot} />;

        const Icon = item.icon;
        return (
          <Pressable
            key={route.key}
            onPress={() => go(route.name, index)}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.label}
            style={styles.slot}
          >
            <Icon
              size={22}
              color={focused ? c.text : c.textMuted}
              strokeWidth={focused ? 2.5 : 1.9}
            />
            <Text
              numberOfLines={1}
              style={[
                typography.tiny,
                styles.label,
                focused ? styles.labelOn : styles.labelOff,
                { color: focused ? c.text : c.textMuted },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    // Explicit numbers, NOT `radius.full` or `radius.xl` read from the theme:
    // a very large radius renders as square on some views under the new
    // architecture, and this one has to be exact anyway.
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  slot: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, height: 48 },
  label: { fontSize: 10.5 },
  labelOn: { fontWeight: "700" },
  labelOff: { fontWeight: "500" },
  discWrap: { width: 48, height: 48 },
  disc: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 10, fontWeight: "800" },
});
