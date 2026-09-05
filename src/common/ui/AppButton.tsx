import React, { useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { radius, shadow, spacing, type ThemeColors, useColors } from "../../theme";

interface Props {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "md" | "lg";
  icon?: LucideIcon;
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
  const solid = variant === "primary" || variant === "danger";
  const fg = solid ? c.white : variant === "outline" ? c.gray[700] : c.brand[600];

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
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          {Icon && <Icon size={18} color={fg} strokeWidth={2.2} />}
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
  primary: { backgroundColor: c.brand[500] },
  danger: { backgroundColor: c.error },
  outline: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.gray[300] },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.9 },
  text: { fontSize: 15, fontWeight: "700" },
});
