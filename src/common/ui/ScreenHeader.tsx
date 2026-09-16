import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  ArrowLeftIcon,
  MenuIcon,
} from "../../common/ui/icons";
import { spacing, type ThemeColors, typography, useColors } from "../../theme";

/**
 * The header every pushed screen wears: a way back, a title, and room on the
 * right for one action.
 *
 * ── Why this is a component and not a pattern ────────────────────────
 *
 * Written out per screen, it went wrong twice in two different ways.
 *
 * Some screens simply had NO back button — Favourites and Reservations are
 * both reachable from the side menu and neither could be left except with the
 * phone's own key, which on a gesture-navigation phone is a swipe nobody is
 * told about.
 *
 * The rest centred their title by putting an empty View opposite the button,
 * and three of them gave that gap the BUTTON's style — so the balancing space
 * rendered as an empty circle floating in the top right.
 *
 * The title here is left-aligned beside the button, so there is no gap to
 * balance and nothing for a spacer to get wrong.
 *
 * ── And then nine screens wrote their own anyway ─────────────────────
 *
 * Measured across every pushed screen, the app had THREE back buttons and TWO
 * title sizes:
 *
 *   38×38 · surfaceAlt · no border · icon 19   ← this component
 *   40×40 · surface    · 1px border · icon 20  ← Addresses, Notifications,
 *                                                Location, Order, Search
 *   36×36 · no ground  · icon 20               ← the shop page's hero overlay
 *
 *   typography.title (22pt)  ← Checkout, Settings, Help, Profile, Browse
 *   typography.h3    (17pt)  ← Addresses, Notifications, Location, Order
 *
 * So somebody moving between Profile and My addresses — two rows of the same
 * menu — met a different header on each, and neither of them was wrong on its
 * own. That is what "consistency ni hai app screens main" was.
 *
 * `HeaderButton` below exists because half of those screens carry an action on
 * the right, and a right-hand control built at the call site is how the second
 * shape appears again next month.
 */

interface Props {
  title: string;
  /** A second line under the title — the shop, the count, who you are. */
  subtitle?: string;
  /** One control on the right: a filter button, a gear, an Empty. */
  right?: React.ReactNode;
  /**
   * Hidden only where there is genuinely nowhere to go — a root tab. Every
   * pushed screen keeps it.
   */
  showBack?: boolean;
  onBack?: () => void;
  /**
   * A hamburger instead of a back arrow.
   *
   * A TAB has nowhere to go back to, so the left slot is either empty or it is
   * the way into the menu. Rider mode needs the second: its board is a root
   * tab, and without this there was no control anywhere on it that could open
   * the side menu — which is where the switch back to shopping lives. A mode
   * you can enter and not leave is a trap, not a mode.
   */
  onMenu?: () => void;
}

/**
 * A control in the header's right slot, wearing the back button's own shape.
 *
 * Exported rather than left to each screen because that is exactly how the
 * 40×40 family started: a screen needed a "+" beside its title, built one, and
 * the next screen copied it. One shape, one definition.
 */
export function HeaderButton({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  /** What a screen reader announces. Required — an icon alone says nothing. */
  label: string;
  children: React.ReactNode;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  return (
    <Pressable
      style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}

export function ScreenHeader({ title, subtitle, right, showBack = true, onBack, onMenu }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();

  return (
    <View style={styles.row}>
      {onMenu != null && (
        <Pressable
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Menu"
          onPress={onMenu}
        >
          <MenuIcon size={20} color={c.text} />
        </Pressable>
      )}
      {onMenu == null && showBack && (
        <Pressable
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack ?? (() => navigation.goBack())}
        >
          <ArrowLeftIcon size={19} color={c.text} />
        </Pressable>
      )}
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.sub} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    back: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    backPressed: { backgroundColor: c.border },
    copy: { flex: 1 },
    title: { ...typography.title, color: c.text },
    sub: { ...typography.tiny, color: c.textSecondary, marginTop: 1 },
  });
