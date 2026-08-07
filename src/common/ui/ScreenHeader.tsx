import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors, radius, spacing, typography } from "../../theme";

interface Action {
  icon: LucideIcon;
  onPress: () => void;
  label?: string;
}

/**
 * Consistent large screen title with optional subtitle and a primary
 * icon-action (e.g. "add"). Used at the top of every list screen.
 */
export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: Action;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {action && (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
        >
          <action.icon size={18} color={colors.white} strokeWidth={2.4} />
          {!!action.label && <Text style={styles.actionLabel}>{action.label}</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  text: { flex: 1, paddingRight: spacing.md },
  title: { ...typography.title, color: colors.gray[900] },
  subtitle: { ...typography.small, color: colors.gray[500], marginTop: 2 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brand[500],
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.full,
  },
  actionLabel: { color: colors.white, fontWeight: "600", fontSize: 13 },
});
