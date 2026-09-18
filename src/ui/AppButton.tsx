import React, { useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import type { Icon } from "./icons";
import { radius, shadow, spacing, type ThemeColors, useColors } from "../theme";

interface Props {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "md" | "lg";
  icon?: Icon;
  style?: ViewStyle;
}

const TAP_GUARD_MS = 600;

/**
 * The app's only button. Double-tap protected (loading + time guard),
 * with optional leading lucide icon and four visual variants.
 */
export function AppButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
  size = "md",
  icon: Icon,
  style,
}: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const lastPress = useRef(0);
  const guardedPress = () => {
    const now = Date.now();
    if (now - lastPress.current < TAP_GUARD_MS) return;
    lastPress.current = now;
    onPress();
  };

  const isDisabled = disabled || loading;

  /**
   * WHAT SITS ON THE BUTTON — asked of the PALETTE, not assumed.
   *
   * This was `solid ? c.white : …`, which was true of every palette this
   * product had ever had until one arrived that cannot carry white: #10b981
   * measures 2.54:1 against it, under even the 3:1 floor for a UI component.
   * The palette had already been corrected — `onPrimary` is ink on the green
   * side, 6.91:1 — and this file simply did not read it.
   *
   * It survived a guard that asserted `contrast(primary, onPrimary) >= 4.5`,
   * because that checked the palette and not its consumer. It took running the
   * app to see it: a sign-in button with a label nobody could read.
   *
   * `danger` keeps white deliberately. Its ground is an error red dark enough
   * to carry it on both themes, and it is not a hue a palette re-points.
   */
  const fg = isDisabled
    ? // `textSecondary`, not `textMuted`. A disabled control is exempt from AA,
      // but somebody still has to READ it to know what filling the form will
      // do — muted measures 2.95:1 on this ground and secondary 5.56:1.
      c.textSecondary
    : variant === "primary"
      ? c.onPrimary
      : variant === "danger"
        ? c.white
        : variant === "outline"
          ? c.gray[700]
          : // The brand as TEXT, which on a light palette is not the brand at
            // full strength — see `primaryPressed` in `themes.ts`.
            c.primaryPressed;

  return (
    <Pressable
      onPress={guardedPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        size === "lg" ? styles.lg : styles.md,
        variant === "primary" && [styles.primary, shadow.sm],
        variant === "danger" && styles.danger,
        variant === "outline" && styles.outline,
        variant === "ghost" && styles.ghost,
        // AFTER the variant, so a disabled button takes a neutral ground
        // rather than a faded brand one.
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          {Icon && <Icon size={18} color={fg} />}
          <Text style={[styles.text, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  md: { height: 50 },
  lg: { height: 56 },
  content: { flexDirection: "row", alignItems: "center", gap: 8 },
  // `c.primary`, not `c.brand[500]`. They agree today, and an index is a fact
  // about a scale while `primary` is a fact about the design — only one of
  // those survives a repalette.
  primary: { backgroundColor: c.primary },
  danger: { backgroundColor: c.error },
  outline: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.gray[300] },
  ghost: { backgroundColor: "transparent" },
  /**
   * A NEUTRAL GROUND, not a half-transparent brand.
   *
   * `opacity: 0.5` halved the contrast of both the fill and its label — on a
   * button whose label was already at 2.54:1 the result was unreadable, and on
   * any palette it makes "not ready yet" look like "broken". A muted surface
   * with muted text says the same thing and stays legible.
   */
  disabled: { backgroundColor: c.surfaceAlt, borderWidth: 0, opacity: 1 },
  pressed: { opacity: 0.9 },
  text: { fontSize: 15, fontWeight: "700" },
});
