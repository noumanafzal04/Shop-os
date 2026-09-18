import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { EmptyState } from "@cartze/core/ui/EmptyState";
import { UtensilsIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";

/**
 * NOT BUILT YET, AND IT SAYS SO.
 *
 * The tab is reachable because `tabsFor` grants it and a tab that exists in
 * the bar and leads nowhere is worse than one that is absent. What it must not
 * do is imply it is working — an empty list with a pull-to-refresh looks like
 * a shop with no orders, which for a shop that HAS orders is a bug report
 * nobody can act on.
 */
export function MenuScreen() {
  const s = styles(useColors());

  return (
    <SafeScreen edges={["top"]}>
      <View style={s.root}>
        <Text style={s.title}>Menu</Text>
        <EmptyState
          icon={UtensilsIcon}
          tone="muted"
          title="Coming in the next release"
          message="Your products, categories, one photo each, and turning an item off when it runs out. Until then, use the CartZe web panel."
        />
      </View>
    </SafeScreen>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, padding: spacing.md },
    title: { ...typography.title, color: c.text },
  });
