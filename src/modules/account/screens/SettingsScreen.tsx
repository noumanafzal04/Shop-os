import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  BellIcon,
  ChevronRightIcon,
  LifeBuoyIcon,
  MapPinIcon,
  MonitorIcon,
  MoonIcon,
  NavigationIcon,
  PersonIcon,
  ShieldCheckIcon,
  SunIcon,
  type Icon,
} from "../../../common/ui/icons";
import { useAuthStore } from "../../../stores/authStore";
import { useModeStore } from "../../../stores/modeStore";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { Touchable } from "../../../common/ui/Touchable";
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

const THEMES: Array<{ value: ThemePreference; label: string; hint: string; icon: Icon }> = [
  { value: "system", label: "System", hint: "Follow the phone", icon: MonitorIcon },
  { value: "light", label: "Light", hint: "Always light", icon: SunIcon },
  { value: "dark", label: "Dark", hint: "Always dark", icon: MoonIcon },
];

export function SettingsScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const { preference, setPreference } = useTheme();
  const navigation = useNavigation<any>();
  const signedIn = useAuthStore((s) => s.status === "authenticated");
  const shopping = useModeStore((s) => s.mode) === "customer";

  /*
   * EVERYTHING A PERSON COMES TO "SETTINGS" FOR, in one place.
   *
   * It held the theme and three lines of "about" — so somebody looking for
   * their password, their notifications or their saved addresses opened
   * Settings, found none of them, and had to know they lived on the Account
   * tab or in the side menu. Those screens stay where they are; this lists
   * them where people look. Addresses and the delivery pin are the shopper's,
   * so a rider's Settings does not offer them.
   */
  const groups: Array<{ title: string; rows: Array<{ icon: Icon; label: string; hint: string; route: string }> }> = [
    ...(signedIn
      ? [
          {
            title: "Account",
            rows: [
              { icon: PersonIcon, label: "Profile", hint: "Name, email and phone", route: "Profile" },
              { icon: ShieldCheckIcon, label: "Password and security", hint: "Password and signed-in devices", route: "Security" },
              { icon: BellIcon, label: "Notifications", hint: "Order updates and offers", route: "Notifications" },
            ],
          },
        ]
      : []),
    ...(shopping
      ? [
          {
            title: "Delivery",
            rows: [
              ...(signedIn
                ? [{ icon: MapPinIcon, label: "Saved addresses", hint: "Home, work and the rest", route: "Addresses" }]
                : []),
              { icon: NavigationIcon, label: "Delivery location", hint: "Where shops are shown for", route: "Location" },
            ],
          },
        ]
      : []),
    {
      title: "Help",
      rows: [{ icon: LifeBuoyIcon, label: "Help centre", hint: "Orders, payments and your account", route: "Help" }],
    },
  ];

  return (
    <SafeScreen backgroundColor={c.bg}>
      <ScreenHeader title="Settings" />

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>Appearance</Text>
        <View style={styles.card}>
          {THEMES.map((t, i) => {
            const on = preference === t.value;
            const Icon = t.icon;
            return (
              <Touchable
                key={t.value}
                style={[styles.row, i > 0 && styles.rowDivided]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setPreference(t.value)}
              >
                <View style={[styles.rowIcon, on && styles.rowIconOn]}>
                  <Icon size={17} color={on ? c.onPrimary : c.textSecondary} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowLabel}>{t.label}</Text>
                  <Text style={styles.rowHint}>{t.hint}</Text>
                </View>
                <View style={[styles.radio, on && styles.radioOn]}>
                  {on && <View style={styles.radioDot} />}
                </View>
              </Touchable>
            );
          })}
        </View>
        <Text style={styles.note}>Your choice is remembered on this phone.</Text>

        {groups.map((g) => (
          <React.Fragment key={g.title}>
            <Text style={styles.section}>{g.title}</Text>
            <View style={styles.card}>
              {g.rows.map((r, i) => {
                const RowIcon = r.icon;
                return (
                  <Touchable
                    key={r.route}
                    style={[styles.row, i > 0 && styles.rowDivided]}
                    accessibilityRole="button"
                    accessibilityLabel={r.label}
                    onPress={() => navigation.navigate(r.route)}
                  >
                    <View style={styles.rowIcon}>
                      <RowIcon size={17} color={c.textSecondary} />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowLabel}>{r.label}</Text>
                      <Text style={styles.rowHint}>{r.hint}</Text>
                    </View>
                    <ChevronRightIcon size={16} color={c.textMuted} />
                  </Touchable>
                );
              })}
            </View>
          </React.Fragment>
        ))}

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
    rowLabel: { ...typography.body, color: c.text, fontSize: 15, lineHeight: 22, fontWeight: "500" },
    rowHint: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    radioOn: { borderColor: c.primary },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary },

    note: { ...typography.tiny, color: c.textMuted, marginTop: spacing.sm },

    aboutRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: spacing.md,
    },
    aboutValue: { ...typography.small, color: c.textSecondary },
  });
