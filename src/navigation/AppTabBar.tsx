import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import {
  BasketIcon,
  CartIcon,
  HomeIcon,
  type IconProps,
  ParcelIcon,
  PersonIcon,
  ReceiptIcon,
  WalletIcon,
} from "../common/ui/icons";
import { useTheme } from "../theme";
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
  icon: React.ComponentType<IconProps>;
}

/**
 * ── WHY THIS BAR HAS ITS OWN GLYPHS ──────────────────────────────────
 *
 * Everywhere else in the app an icon is a Lucide outline, and that is right:
 * one family, one stroke weight, one colour. A bottom bar is the exception,
 * because it has a job no other row of icons has — saying WHICH ONE YOU ARE
 * ON — and it has to say it at 22 points, without a label being read.
 *
 * This bar used to answer with half a point of stroke width and two greys.
 * Selected and unselected looked the same at arm's length. The five glyphs in
 * `common/ui/icons/TabIcons` are drawn as silhouettes so the selected one can
 * be SOLID and in the brand colour, which is how every app of this kind
 * answers it and the reason they all do.
 *
 * They are deliberately NOT read from the trade-icon map any more. That map
 * exists so the chips, the shortcuts and the shop cards cannot drift apart,
 * and its icons are stroked-only — reading it here is what made two of these
 * slots impossible to fill. The bar states its own set instead, which is five
 * lines and not a copy of anything.
 */
const ITEMS: Record<string, Item> = {
  // The home screen, called Home. It was labelled "Food" while showing the
  // marketplace home, with a crossed-utensils glyph — a first tab that names
  // one of the shortcuts inside it.
  FoodTab: { route: "FoodTab", label: "Home", icon: HomeIcon },
  // A basket, deliberately not a trolley: the middle button is a trolley and
  // two of them in one bar is two words for different things.
  GroceryTab: { route: "GroceryTab", label: "Grocery", icon: BasketIcon },
  CartTab: { route: "CartTab", label: "Cart", icon: CartIcon },
  OrdersTab: { route: "OrdersTab", label: "Orders", icon: ReceiptIcon },
  AccountTab: { route: "AccountTab", label: "Account", icon: PersonIcon },

  // ── Rider mode ──────────────────────────────────────────────────
  //
  // The SAME bar, a different set of slots. It is one component because the
  // shape is one decision — the height, the hairline, the rounded top edge,
  // the rule that nothing in it may change size — and two copies of that
  // would drift the first time either was touched.
  //
  // No basket here, and that is the point of the mode: somebody delivering is
  // not shopping.
  RiderBoardTab: { route: "RiderBoardTab", label: "Deliveries", icon: ParcelIcon },
  RiderEarningsTab: { route: "RiderEarningsTab", label: "Earnings", icon: WalletIcon },
  RiderAccountTab: { route: "RiderAccountTab", label: "Account", icon: PersonIcon },
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
    /*
      ── A PILL RESTING ON THE PAGE, THE WAY FOODPANDA'S BAR DOES ─────────

      "Footer acha bnana hai." The bar was a full-width white slab with a
      raised basket disc in the middle — a button that needed a halo to read
      as a button. The reference app's bar is a rounded white pill inset from
      the edges, and the tab you are on sits inside a soft pill of its own.

      It stays IN the layout (not `position: absolute`): the ground around the
      pill is the page's own colour, so it reads as floating while no list can
      ever end underneath it.
    */
    <View style={[styles.ground, { backgroundColor: c.bg, paddingBottom: Math.max(insets.bottom, 8) + 6 }]}>
      <View style={[styles.bar, { backgroundColor: c.surface, borderColor: c.border }]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const item = ITEMS[route.name];
          if (!item) return <View key={route.key} style={styles.slot} />;

          const Icon = item.icon;
          const isCart = route.name === "CartTab";
          return (
            <Pressable
              key={route.key}
              onPress={() => go(route.name, index)}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={isCart && count > 0 ? `Cart, ${count} items` : item.label}
              style={styles.slot}
            >
              {/*
                The tab you are on: its icon and label inside one soft pill,
                in the brand colour, the icon in its solid weight. Nothing
                changes size between the two states — only the fill.
              */}
              <View style={styles.pill}>
                {/*
                  The soft pill sits behind the ICON only, a fixed 56×32 —
                  on a real phone the whole-slot version grew with the font
                  size, lost its rounding and ran out of the bar.
                */}
                <View style={[styles.iconWrap, focused && { backgroundColor: c.primarySoft }]}>
                  <Icon size={23} bold={focused} color={focused ? c.primary : c.textMuted} />
                  {/* The basket counts against its own icon, not the slot. */}
                  {isCart && count > 0 && (
                    <View style={[styles.badge, { backgroundColor: c.warm, borderColor: c.surface }]}>
                      <Text style={[styles.badgeText, { color: c.onWarm }]}>{count > 99 ? "99+" : count}</Text>
                    </View>
                  )}
                </View>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.2}
                  style={[
                    typography.tiny,
                    styles.label,
                    focused ? styles.labelOn : styles.labelOff,
                    { color: focused ? c.primary : c.textMuted },
                  ]}
                >
                  {item.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { paddingHorizontal: 14, paddingTop: 6 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 66,
    paddingHorizontal: 6,
    borderRadius: 33,
    borderWidth: StyleSheet.hairlineWidth,
    // A lift, not a line: the pill sits ON the page.
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  slot: { flex: 1, alignItems: "center", justifyContent: "center", height: 66 },
  pill: { alignItems: "center", justifyContent: "center", gap: 3 },
  // 12, not 16: a radius of exactly half the height renders SQUARE under
  // Fabric on a real phone — the box the user saw.
  iconWrap: { width: 56, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  // Never scaled past the bar: the label is the one thing font size grows.
  label: { fontSize: 11, lineHeight: 14 },
  labelOn: { fontWeight: "700" },
  labelOff: { fontWeight: "500" },
  badge: {
    position: "absolute",
    top: -3,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 10, lineHeight: 12, fontWeight: "800" },
});
