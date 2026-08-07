import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors, spacing, typography } from "../../theme";
import { Card } from "./Card";
import { IconChip } from "./IconChip";
import { Skeleton } from "./Skeleton";

interface Props {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tint?: string;
  bg?: string;
  hint?: string;
}

export function StatCard({ label, value, icon, tint, bg, hint }: Props) {
  return (
    <Card style={styles.card}>
      <IconChip icon={icon} size={40} tint={tint} bg={bg} />
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      {!!hint && <Text style={styles.hint} numberOfLines={1}>{hint}</Text>}
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card style={styles.card}>
      <Skeleton width={40} height={40} borderRadius={12} />
      <Skeleton width="55%" height={22} style={{ marginTop: spacing.sm }} />
      <Skeleton width="40%" height={12} style={{ marginTop: spacing.xs }} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: "44%" },
  value: { ...typography.title, fontSize: 24, color: colors.gray[900], marginTop: spacing.sm },
  label: { ...typography.small, color: colors.gray[500], marginTop: 2 },
  hint: { ...typography.tiny, color: colors.gray[400], marginTop: 2 },
});
