import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  Heart,
  LogOut,
  MapPin,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { colors, radius, spacing, typography } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import { useLogout } from "../../auth/hooks/useAuth";

/** Account tab — profile + everything that isn't a main tab. */
export function AccountScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const signOut = useLogout();

  if (status !== "authenticated") {
    return (
      <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
        <View style={styles.guestWrap}>
          <View style={styles.avatar}>
            <UserRound size={34} color={colors.brand[500]} strokeWidth={1.8} />
          </View>
          <Text style={styles.guestTitle}>You're browsing as a guest</Text>
          <Text style={styles.guestText}>Sign in to order, save addresses and track deliveries.</Text>
          <AppButton title="Sign in" onPress={() => navigation.navigate("SignIn")} />
        </View>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile header */}
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0) ?? "?"}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.contact}>{user?.phone ?? user?.email ?? ""}</Text>
          </View>
        </View>

        {/* Menu */}
        <View style={styles.menu}>
          <MenuItem icon={MapPin} label="My addresses" onPress={() => navigation.navigate("Addresses")} />
          <MenuItem icon={Heart} label="Favorites" onPress={() => navigation.navigate("Favorites")} />
          <MenuItem icon={CalendarClock} label="Reservations" onPress={() => navigation.navigate("Reservations")} />
          <MenuItem icon={Bell} label="Notifications" onPress={() => navigation.navigate("Notifications")} />
        </View>

        <View style={styles.menu}>
          <MenuItem
            icon={LogOut}
            label="Sign out"
            destructive
            onPress={() => signOut.mutate()}
          />
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onPress,
  destructive = false,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable style={styles.item} onPress={onPress}>
      <View style={[styles.itemIcon, destructive && styles.itemIconDanger]}>
        <Icon size={18} color={destructive ? colors.error : colors.brand[600]} strokeWidth={2} />
      </View>
      <Text style={[styles.itemLabel, destructive && styles.itemLabelDanger]}>{label}</Text>
      <ChevronRight size={18} color={colors.gray[300]} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  guestWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  guestTitle: { ...typography.h3, color: colors.black, marginTop: spacing.sm },
  guestText: { ...typography.small, color: colors.gray[500], textAlign: "center", marginBottom: spacing.md },

  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    margin: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { ...typography.display, color: colors.brand[600], fontSize: 26 },
  profileInfo: { flex: 1, gap: 2 },
  name: { ...typography.h3, color: colors.black },
  contact: { ...typography.small, color: colors.gray[500] },

  menu: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center",
  },
  itemIconDanger: { backgroundColor: colors.errorBg },
  itemLabel: { ...typography.body, color: colors.black, flex: 1, fontWeight: "500" },
  itemLabelDanger: { color: colors.error },
});
