import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { BRAND } from "../../../common/brand";

/**
 * The half second the Keychain takes to answer.
 *
 * It exists so the sign-in screen does NOT appear during it. A form that shows
 * for a moment and then vanishes is one somebody has already started typing
 * into, and an app that remembers you should never look like one that does
 * not.
 *
 * The spinner is delayed rather than immediate — see below.
 */
export function BootScreen() {
  const c = useColors();
  const s = styles(c);

  /**
   * Nothing for the first 400ms.
   *
   * The Keychain usually answers in under a tenth of a second. A spinner that
   * appears and disappears inside 100ms is a flash of anxiety about a wait
   * that did not happen; one that appears only when there IS a wait tells the
   * truth both times.
   */
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={s.root}>
      <Text style={s.wordmark}>{BRAND.family}</Text>
      <Text style={s.sub}>Partner</Text>
      {slow ? <ActivityIndicator color={c.primary} style={s.spinner} /> : null}
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
    wordmark: { ...typography.display, fontSize: 34, color: c.primary, letterSpacing: -0.6 },
    sub: {
      ...typography.label,
      fontSize: 15,
      color: c.textSecondary,
      letterSpacing: 3,
      textTransform: "uppercase",
      marginTop: spacing.xs,
    },
    spinner: { marginTop: spacing.xl },
  });
