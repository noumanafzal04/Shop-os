import React from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { Touchable } from "@cartze/core/ui/Touchable";
import { confirm } from "@cartze/core/ui/confirm";
import {
  BadgeCheckIcon,
  ChevronRightIcon,
  GearIcon,
  MoonIcon,
  PersonIcon,
  SignOutIcon,
  StorefrontIcon,
  SunIcon,
  type Icon,
} from "@cartze/core/ui/icons";
import { useTheme, spacing, typography, useColors, type ThemeColors, type ThemePreference } from "@cartze/core/theme";
import { BRAND } from "../../../common/brand";
import { useAuthStore } from "../../../stores/authStore";
import { stopPush } from "../../../services/push";
import type { AccountStackParamList } from "../../../navigation/types";

/**
 * WHO YOU ARE, WHICH SHOP, AND THE WAY OUT.
 *
 * Phase 1 shows what the session already knows and offers the two controls
 * that need nothing from the server: the theme, and signing out. Editing a
 * profile, changing a password and the notification settings arrive with the
 * screens that own them — an Account page full of rows that open nothing is
 * worse than a short one.
 */
export function AccountScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation<NativeStackNavigationProp<AccountStackParamList>>();
  const { preference, setPreference } = useTheme();
  const user = useAuthStore((st) => st.user);
  const clear = useAuthStore((st) => st.clear);
  const can = useAuthStore((st) => st.can);

  async function signOut() {
    const yes = await confirm.ask({
      title: "Sign out?",
      /**
       * Named, because signing out of a shared shop phone is a thing people do
       * by accident and the cost is somebody having to find the password
       * again — mid-service, usually.
       */
      message: `You will need your password to sign back in to ${user?.tenant?.business_name ?? "this shop"}.`,
      confirmLabel: "Sign out",
      tone: "danger",
    });

    if (!yes) return;

    /**
     * UNREGISTER BEFORE CLEARING THE SESSION, not after.
     *
     * The call needs the token it is about to throw away. Done in the other
     * order it goes out unauthenticated and the server keeps pushing this
     * shop's orders — naming a customer each time — to a phone somebody else
     * is now holding.
     */
    await stopPush();
    await clear();
  }

  return (
    <SafeScreen edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.screenTitle}>Account</Text>

        <View style={s.card}>
          <View style={s.who}>
            <View style={s.avatar}>
              <PersonIcon size={26} color={c.onPrimary} />
            </View>
            <View style={s.whoText}>
              <Text style={s.name} numberOfLines={1}>
                {user?.name ?? "—"}
              </Text>
              <Text style={s.contact} numberOfLines={1}>
                {user?.email ?? user?.phone ?? "No contact on file"}
              </Text>
            </View>
          </View>
        </View>

        <Text style={s.sectionTitle}>Shop</Text>
        <View style={s.card}>
          <Row
            icon={StorefrontIcon}
            label={user?.tenant?.business_name ?? "—"}
            value={user?.tenant?.city?.name ?? undefined}
          />
          {user?.tenant?.plan ? (
            <Row icon={BadgeCheckIcon} label="Plan" value={user.tenant.plan.name} />
          ) : null}
          {/**
            * SETTINGS ARE OFFERED ONLY TO SOMEBODY WHO MAY CHANGE THEM.
            *
            * `settings.manage` gates the route; showing the row to a cashier
            * would be a door that opens onto a refusal, which this codebase
            * has paid for before under the name "offered must be reachable".
            */}
          {can("settings.manage") ? (
            <Touchable
              onPress={() => nav.navigate("Shop")}
              accessibilityRole="button"
              style={s.row}
            >
              <GearIcon size={20} color={c.textSecondary} />
              <Text style={s.rowLabel}>Shop settings</Text>
              <ChevronRightIcon size={18} color={c.textMuted} />
            </Touchable>
          ) : null}
        </View>

        <Text style={s.sectionTitle}>Appearance</Text>
        <View style={s.card}>
          <View style={s.themeRow}>
            {(["light", "dark", "system"] as ThemePreference[]).map((option) => {
              const on = preference === option;
              return (
                <Touchable
                  key={option}
                  onPress={() => setPreference(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[s.themeChip, on ? s.themeChipOn : null]}
                >
                  {option === "light" ? (
                    <SunIcon size={16} color={on ? c.primaryPressed : c.textSecondary} />
                  ) : option === "dark" ? (
                    <MoonIcon size={16} color={on ? c.primaryPressed : c.textSecondary} />
                  ) : null}
                  <Text style={[s.themeText, on ? s.themeTextOn : null]}>
                    {option === "system" ? "Automatic" : option === "light" ? "Light" : "Dark"}
                  </Text>
                </Touchable>
              );
            })}
          </View>
        </View>

        <Touchable onPress={signOut} accessibilityRole="button" style={[s.card, s.signOut]}>
          <SignOutIcon size={20} color={c.error} />
          <Text style={s.signOutText}>Sign out</Text>
        </Touchable>

        <Text style={s.version}>
          {BRAND.name} {BRAND.version}
        </Text>
      </ScrollView>
    </SafeScreen>
  );
}

function Row({
  icon: Glyph,
  label,
  value,
  last,
}: {
  icon: Icon;
  label: string;
  value?: string;
  last?: boolean;
}) {
  const c = useColors();
  const s = styles(c);

  return (
    <View style={[s.row, last ? null : s.rowRule]}>
      <Glyph size={20} color={c.textSecondary} />
      <Text style={s.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={s.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
    screenTitle: { ...typography.title, color: c.text, marginBottom: spacing.sm },
    sectionTitle: {
      ...typography.label,
      color: c.textSecondary,
      marginTop: spacing.md,
      marginLeft: 2,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: "hidden",
    },

    who: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
    avatar: {
      width: 52,
      height: 52,
      // Not `radius.full`: 9999 renders SQUARE on small views under Fabric,
      // which is a documented trap in this product and cost thirty views once.
      borderRadius: 26,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    whoText: { flex: 1, gap: 2 },
    name: { ...typography.h3, fontSize: 18, color: c.text },
    contact: { ...typography.small, color: c.textSecondary },

    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
    rowRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rowLabel: { ...typography.body, color: c.text, flex: 1 },
    rowValue: { ...typography.small, color: c.textSecondary },

    themeRow: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
    themeChip: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: spacing.sm + 2,
      borderRadius: 12,
      backgroundColor: c.surfaceAlt,
    },
    themeChipOn: { backgroundColor: c.primarySoft },
    themeText: { ...typography.label, fontSize: 13, color: c.textSecondary },
    /**
     * `primaryPressed`, not `primary`.
     *
     * On the green palette the brand at full strength measures 2.41:1 against
     * its own soft tint — a label nobody can read. The palette names a
     * text-safe shade for exactly this, and a chip on a tint is the case it
     * was named for.
     */
    themeTextOn: { color: c.primaryPressed, fontWeight: "700" },

    signOut: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md + 2,
      marginTop: spacing.lg,
    },
    signOutText: { ...typography.label, fontSize: 15, color: c.error },

    version: { ...typography.tiny, fontSize: 12, color: c.textMuted, textAlign: "center", marginTop: spacing.lg },
  });
