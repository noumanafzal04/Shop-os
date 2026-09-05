import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft } from "lucide-react-native";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../theme";

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
}

export function ScreenHeader({ title, subtitle, right, showBack = true, onBack }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();

  return (
    <View style={styles.row}>
      {showBack && (
        <Pressable
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack ?? (() => navigation.goBack())}
        >
          <ArrowLeft size={19} color={c.text} strokeWidth={2.3} />
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
      borderRadius: radius.full,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    backPressed: { backgroundColor: c.border },
    copy: { flex: 1 },
    title: { ...typography.title, color: c.text },
    sub: { ...typography.tiny, color: c.textSecondary, marginTop: 1 },
  });
