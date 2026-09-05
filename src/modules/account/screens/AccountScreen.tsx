import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  Heart,
  LifeBuoy,
  LogOut,
  MapPin,
  Receipt,
  Settings as SettingsIcon,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { confirm } from "../../../common/ui/confirm";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import { useLogout } from "../../auth/hooks/useAuth";

/**
 * The Account tab.
 *
 * ── What changed, and why the shape is worth stating ─────────────────
 *
 * It used to be a name, a phone number, and a flat list of four links. Which
 * is honest but says nothing about what matters: the three things anybody
 * opens this tab for — an order, a saved shop, an address — sat in the same
 * type and the same row height as "Notifications".
 *
 * So: WHO you are at the top, with the one control that edits it; then those
 * three as tiles you can hit without reading; then everything else as a list,
 * because everything else genuinely is a list.
 *
 * ── Guests get the same tab ──────────────────────────────────────────
 *
 * Not a redirect to sign-in. A guest may browse the whole app and is asked for
 * an account only where an order needs one — this tab explains what signing in
 * buys rather than demanding it.
 */

interface Link {
  icon: LucideIcon;
  label: string;
  hint?: string;
  route: string;
}

const GENERAL: Link[] = [
  { icon: Bell, label: "Notifications", hint: "Order updates and offers", route: "Notifications" },
  { icon: CalendarClock, label: "Reservations", route: "Reservations" },
  { icon: LifeBuoy, label: "Help centre", hint: "How ordering, payment and cancelling work", route: "Help" },
];

export function AccountScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const signOut = useLogout();
  const signedIn = status === "authenticated";

  const askSignOut = () => {
    confirm
      .ask({
        title: "Sign out?",
        message: "Your basket stays on this phone.",
        confirmLabel: "Sign out",
        cancelLabel: "Stay",
        tone: "danger",
      })
      .then((yes) => {
        if (yes) signOut.mutate();
      })
      .catch(() => {});
  };

  /** A tile's destination, or the sign-in wall if it needs an account. */
  const open = (route: string, params?: object) => {
    if (!signedIn) {
      navigation.navigate("SignIn");
      return;
    }
    navigation.navigate(route, params);
  };

  return (
    <SafeScreen backgroundColor={c.bg} edges={["top"]}>
      <View style={styles.head}>
        <Text style={styles.headTitle}>Account</Text>
        <Pressable
          style={styles.gear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => navigation.navigate("Settings")}
        >
          <SettingsIcon size={20} color={c.text} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {/* Who you are — and the only control that changes it. */}
        <Pressable
          style={styles.who}
          accessibilityRole="button"
          accessibilityLabel={signedIn ? "View profile" : "Sign in"}
          onPress={() => navigation.navigate(signedIn ? "Profile" : "SignIn")}
        >
          <View style={styles.avatar}>
            {signedIn && user?.name ? (
              <Text style={styles.avatarText}>{user.name.trim().charAt(0).toUpperCase()}</Text>
            ) : (
              <UserRound size={26} color={c.onPrimary} strokeWidth={2} />
            )}
          </View>
          <View style={styles.whoCopy}>
            <Text style={styles.whoName} numberOfLines={1}>
              {signedIn ? (user?.name ?? "Your account") : "You're browsing as a guest"}
            </Text>
            <Text style={styles.whoLink}>
              {signedIn ? "View profile" : "Sign in to order and follow deliveries"}
            </Text>
          </View>
          <ChevronRight size={18} color={c.textMuted} strokeWidth={2.2} />
        </Pressable>

        {!signedIn && (
          <AppButton
            title="Sign in"
            onPress={() => navigation.navigate("SignIn")}
            style={styles.signIn}
          />
        )}

        {/* The three reasons anybody opens this tab. */}
        <View style={styles.tiles}>
          <Tile icon={Receipt} label="Orders" onPress={() => open("OrdersTab")} />
          <Tile icon={Heart} label="Favourites" onPress={() => open("Favorites")} />
          <Tile icon={MapPin} label="Addresses" onPress={() => open("Addresses")} />
        </View>

        <Text style={styles.section}>General</Text>
        <View style={styles.card}>
          {GENERAL.map((l, i) => (
            <Row key={l.label} link={l} divided={i > 0} onPress={() => open(l.route)} />
          ))}
        </View>

        {signedIn && (
          <Pressable
            style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
            accessibilityRole="button"
            onPress={askSignOut}
          >
            <LogOut size={17} color={c.error} strokeWidth={2.2} />
            <Text style={styles.signOutText}>
              {signOut.isPending ? "Signing out…" : "Log out"}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

function Tile({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <Icon size={21} color={c.primary} strokeWidth={2} />
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

function Row({
  link,
  divided,
  onPress,
}: {
  link: Link;
  divided: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const Icon = link.icon;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, divided && styles.rowDivided, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={link.label}
      onPress={onPress}
    >
      <Icon size={19} color={c.textSecondary} strokeWidth={2} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{link.label}</Text>
        {!!link.hint && <Text style={styles.rowHint}>{link.hint}</Text>}
      </View>
      <ChevronRight size={16} color={c.textMuted} strokeWidth={2.2} />
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    headTitle: { ...typography.title, color: c.text },
    gear: {
      width: 38,
      height: 38,
      borderRadius: radius.full,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },

    body: { padding: spacing.md, paddingBottom: spacing.xl },

    who: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { ...typography.h3, color: c.onPrimary, fontSize: 21 },
    whoCopy: { flex: 1 },
    whoName: { ...typography.h3, color: c.text, fontSize: 17 },
    whoLink: { ...typography.small, color: c.primary, fontWeight: "700", marginTop: 2 },

    signIn: { marginTop: spacing.md },

    tiles: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
    tile: {
      flex: 1,
      alignItems: "center",
      gap: 7,
      paddingVertical: spacing.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
    },
    tilePressed: { backgroundColor: c.surfaceAlt },
    tileLabel: { ...typography.small, color: c.text, fontWeight: "600" },

    section: {
      ...typography.tiny,
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: spacing.lg,
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
    rowPressed: { backgroundColor: c.surfaceAlt },
    rowCopy: { flex: 1 },
    rowLabel: { ...typography.body, color: c.text, fontSize: 14.5, fontWeight: "500" },
    rowHint: { ...typography.tiny, color: c.textMuted, marginTop: 1 },

    signOut: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      marginTop: spacing.lg,
      paddingVertical: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    signOutPressed: { backgroundColor: c.surfaceAlt },
    signOutText: { ...typography.label, color: c.error, fontSize: 14 },
  });
