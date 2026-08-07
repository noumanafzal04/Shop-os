import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, shadow, spacing } from "../../theme";

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  padded?: boolean;
  elevated?: boolean;
}

/**
 * The base surface for the whole app — soft-shadowed, rounded, bordered.
 */
export function Card({ children, style, onPress, onLongPress, padded = true, elevated = true }: Props) {
  const cardStyle = [
    styles.card,
    padded && styles.padded,
    elevated && shadow.md,
    style,
  ];

  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [...cardStyle, pressed && styles.pressed]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  padded: { padding: spacing.md },
  pressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },
});
