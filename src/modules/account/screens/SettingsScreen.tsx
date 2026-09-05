import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, Monitor, Moon, Sun, type LucideIcon } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { BRAND } from "../../../common/brand";
import {
  radius,
  spacing,
  type ThemeColors,
  type ThemePreference,
  typography,
  useColors,
  useTheme,
} from "../../../theme";

/**
 * Settings.
 *
 * ── Why appearance is the only thing here ────────────────────────────
 *
 * Because it is the only preference this app actually has. A settings screen
 * that lists a language picker with one language, or a notifications switch
 * wired to nothing, is worse than a short settings screen: every row is a
 * promise, and a row that changes nothing is a promise broken silently.
 *
 * Urdu and per-topic notification controls both belong here. They arrive when
 * the things behind them do.
 */

const THEMES: Array<{ value: ThemePreference; label: string; hint: string; icon: LucideIcon }> = [
  { value: "system", label: "System", hint: "Follow the phone", icon: Monitor },
  { value: "light", label: "Light", hint: "Always light", icon: Sun },
  { value: "dark", label: "Dark", hint: "Always dark", icon: Moon },
];

export function SettingsScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const { preference, setPreference } = useTheme();

  return (
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.head}>
        <Pressable
          style={styles.back}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
        >
          <ArrowLeft size={19} color={c.text} strokeWidth={2.3} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>Appearance</Text>
        <View style={styles.card}>
          {THEMES.map((t, i) => {
            const on = preference === t.value;
            const Icon = t.icon;
            return (
              <Pressable
                key={t.value}
                style={[styles.row, i > 0 && styles.rowDivided]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setPreference(t.value)}
              >
                <View style={[styles.rowIcon, on && styles.rowIconOn]}>
                  <Icon size={17} color={on ? c.onPrimary : c.textSecondary} strokeWidth={2.2} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowLabel}>{t.label}</Text>
                  <Text style={styles.rowHint}>{t.hint}</Text>
                </View>
                <View style={[styles.radio, on && styles.radioOn]}>
                  {on && <View style={styles.radioDot} />}
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.note}>Your choice is remembered on this phone.</Text>

        <Text style={styles.section}>About</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.rowLabel}>App</Text>
            <Text style={styles.aboutValue}>{BRAND.name}</Text>
          </View>
          <View style={[styles.aboutRow, styles.rowDivided]}>
            <Text style={styles.rowLabel}>Website</Text>
            <Text style={styles.aboutValue}>{BRAND.domain}</Text>
          </View>
          <View style={[styles.aboutRow, styles.rowDivided]}>
            <Text style={styles.rowLabel}>Payment</Text>
            <Text style={styles.aboutValue}>Cash on delivery</Text>
          </View>
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    head: {
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
    title: { ...typography.title, color: c.text },

    body: { padding: spacing.md, paddingBottom: spacing.xl },
    section: {
      ...typography.tiny,
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
    rowDivided: { borderTopWidth: 1, borderTopColor: c.border },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: radius.sm,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    rowIconOn: { backgroundColor: c.primary },
    rowCopy: { flex: 1 },
    rowLabel: { ...typography.body, color: c.text, fontSize: 14.5, fontWeight: "500" },
    rowHint: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
    radio: {
      width: 20,
      height: 20,
      borderRadius: radius.full,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    radioOn: { borderColor: c.primary },
    radioDot: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: c.primary },

    note: { ...typography.tiny, color: c.textMuted, marginTop: spacing.sm },

    aboutRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: spacing.md,
    },
    aboutValue: { ...typography.small, color: c.textSecondary },
  });
