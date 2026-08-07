import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../../theme";
import { Skeleton } from "./Skeleton";

interface Props {
  label: string;
  value: string | number;
  hint?: string;
}

export function MetricCard({ label, value, hint }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

export function MetricCardSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton width="60%" height={12} />
      <Skeleton width="40%" height={22} style={{ marginTop: spacing.sm }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gray[200],
    padding: spacing.md,
  },
  label: { ...typography.small, color: colors.gray[500] },
  value: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.gray[900],
    marginTop: spacing.xs,
  },
  hint: { ...typography.small, color: colors.gray[400], marginTop: 2 },
});
