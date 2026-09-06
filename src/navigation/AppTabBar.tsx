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
                ── THE MIDDLE BUTTON, THIRD ATTEMPT ────────────────────
                
                In the bar, not out of it. The raised version needed a thick
                ring in the page's colour to stop it reading as a hole punched
                through the bar — a button that needs a cut-out around it to be
                legible is a button fighting its own container.
                
                What was wrong with the version after that: a flat brand circle
                with a hairline outline cart inside it. Correct, and it read as
                a coloured dot. Three things fix that without raising it again:
                
                  · a HALO — the brand at a tenth of its strength, behind the
                    disc. It gives depth on a theme that forbids shadows, and
                    it is the only thing in the bar that says the basket is a
                    different KIND of control from the four beside it.
                  · a SOLID glyph, with the handle knocked back out in the
                    disc's own colour, so the shape reads at 24 points instead
                    of dissolving into the fill behind it.
                  · a squircle rather than a circle, which is the corner the
                    rest of this app turns everywhere else.
                
                The halo strengthens when the tab is selected — the one state
                this button never showed at all.
              */}
              {/*
                The badge is positioned against the DISC, not the slot.

                Anchored to the slot it measured from the slot's edge — a fifth
                of a 178px column away from a 48px circle — so it floated in
                open space beside the button it was counting.
              */}
              <View style={styles.discWrap}>
                <View
                  style={[
                    styles.halo,
                    { backgroundColor: c.primary, opacity: focused ? 0.2 : 0.11 },
                  ]}
                />
                <View style={[styles.disc, { backgroundColor: c.primary }]}>
                  <CartIcon size={24} color={c.onPrimary} bold />
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
            {/*
              SOLID WHEN YOU ARE ON IT, outline when you are not — and the
              brand colour rather than a darker grey. Two greys and half a
              point of stroke was the whole of the old answer, and at arm's
              length it was no answer.

              Two weights of the same drawing, so nothing moves and nothing
              changes size — the state is entirely in the fill and the colour.
            */}
            <Icon size={23} bold={focused} color={focused ? c.primary : c.textMuted} />
            <Text
              numberOfLines={1}
              style={[
                typography.tiny,
                styles.label,
                focused ? styles.labelOn : styles.labelOff,
                { color: focused ? c.primary : c.textMuted },
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
  slot: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, height: 50 },
  label: { fontSize: 10.5 },
  labelOn: { fontWeight: "700" },
  labelOff: { fontWeight: "500" },
  discWrap: { width: 50, height: 50, alignItems: "center", justifyContent: "center" },
  // The brand at a tenth of its strength, one step wider than the disc. Depth
  // on a theme with no shadows in it.
  halo: {
    position: "absolute",
    width: 50,
    height: 50,
    borderRadius: 17,
  },
  disc: {
    width: 44,
    height: 44,
    // A squircle, not a circle: every other rounded thing in this app turns
    // this corner, and a lone perfect circle in the middle of them reads as
    // borrowed.
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 1,
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
