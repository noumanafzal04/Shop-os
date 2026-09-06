import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Lock,
  LogOut,
  Monitor,
  Smartphone,
  Tablet,
} from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { Touchable } from "../../../common/ui/Touchable";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { confirm } from "../../../common/ui/confirm";
import { toast } from "../../../common/ui/toast";
import { ApiError } from "../../../common/types/api";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { accountService, type AuthSession } from "../services/accountService";
import { useLogoutEverywhere } from "../../auth/hooks/useAuth";

/**
 * SECURITY.
 *
 * ── Why this screen exists ───────────────────────────────────────────
 *
 * The account tab had four links, none of them about the account. There was no
 * way to change a password from the phone at all, and no way to find out which
 * devices were signed in — both of which the API has answered since the first
 * release. The screens were the missing half, not the endpoints.
 *
 * ── The two halves, and why they are on one screen ───────────────────
 *
 * They are the same question asked twice: WHO CAN GET IN. Somebody who thinks
 * another person has their password wants to change it AND see the other phone
 * disappear, in one visit, without being told to look somewhere else for the
 * second half.
 *
 * The server ties them together too — changing a password revokes every other
 * session — and a screen that hides that would be a screen whose user is
 * surprised by their own tablet asking them to sign in again.
 */

/** How a device is named. There are three shapes and they carry no more. */
function deviceIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("tablet") || n.includes("ipad")) return Tablet;
  if (n.includes("web") || n.includes("panel") || n.includes("desktop")) return Monitor;
  return Smartphone;
}

/**
 * When it was last used, in the words somebody would use.
 *
 * Exact timestamps are the wrong answer here: the question is "is that me?",
 * and "2 hours ago" answers it where "6 Sept 2026, 11:04" makes you do
 * arithmetic first.
 */
export function lastSeen(iso: string | null): string {
  if (iso == null) return "Never used";

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown";

  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "Active now";
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  return new Date(iso).toLocaleDateString();
}

export function SecurityScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const queryClient = useQueryClient();

  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");

  const devices = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async () => (await accountService.sessions()).data,
  });

  const change = useMutation({
    mutationFn: () =>
      accountService.changePassword({
        current_password: current,
        password: next,
        password_confirmation: confirmation,
      }),
    // Handled here rather than by the global toast: a field error belongs on
    // the form that caused it.
    meta: { silent: true },
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirmation("");
      toast.success("Password changed", {
        detail: "Every other device has been signed out.",
      });
      // The list is now shorter by however many devices the server dropped.
      queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => accountService.revokeSession(id),
    onSuccess: () => {
      toast.success("Device signed out");
      queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
  });

  const everywhere = useLogoutEverywhere();

  const askRevoke = (s: AuthSession) => {
    confirm
      .ask({
        title: "Sign this device out?",
        message: `${s.device_name} will have to sign in again.`,
        confirmLabel: "Sign it out",
        cancelLabel: "Keep it",
        tone: "danger",
      })
      .then((yes) => {
        if (yes) revoke.mutate(s.id);
      })
      .catch(() => {});
  };

  const askEverywhere = () => {
    confirm
      .ask({
        title: "Sign out everywhere?",
        message: "Every device signs out, including this phone. Your basket stays here.",
        confirmLabel: "Sign out everywhere",
        cancelLabel: "Cancel",
        tone: "danger",
      })
      .then((yes) => {
        if (yes) everywhere.mutate();
      })
      .catch(() => {});
  };

  const error =
    change.error instanceof ApiError
      ? (change.error.firstFieldError() ?? change.error.message)
      : change.error
        ? "Could not change the password. Please try again."
        : null;

  /**
   * The button is off until the form could actually succeed.
   *
   * `different:current_password` and `min:8` are the server's rules, checked
   * here as well — not instead. Sending a request that is certain to fail
   * spends somebody's connection to tell them something the phone already knew.
   */
  const ready =
    current.length > 0 &&
    next.length >= 8 &&
    next === confirmation &&
    next !== current;

  const list = devices.data ?? [];

  return (
    <SafeScreen backgroundColor={c.bg}>
      <ScreenHeader title="Security" subtitle="Your password and the devices signed in" />

      <KeyboardScreen contentStyle={styles.body}>
        <Text style={styles.section}>Change password</Text>
        <View style={styles.card}>
          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <AppTextInput
            label="Current password"
            icon={Lock}
            secureTextEntry
            value={current}
            onChangeText={setCurrent}
            autoCapitalize="none"
            textContentType="password"
          />
          <AppTextInput
            label="New password"
            icon={KeyRound}
            secureTextEntry
            value={next}
            onChangeText={setNext}
            autoCapitalize="none"
            textContentType="newPassword"
          />
          <AppTextInput
            label="New password again"
            icon={KeyRound}
            secureTextEntry
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="none"
            textContentType="newPassword"
            error={
              // Said as it happens, not after a round trip. Nothing else on
              // this form can be checked without the server.
              confirmation.length > 0 && confirmation !== next
                ? "The two do not match."
                : null
            }
          />

          <Text style={styles.rule}>
            At least 8 characters, and not the one you are using now.
          </Text>

          <AppButton
            title={change.isPending ? "Changing…" : "Change password"}
            onPress={() => change.mutate()}
            loading={change.isPending}
            disabled={!ready}
          />
          <Text style={styles.rule}>
            Changing it signs out every other device. This one stays signed in.
          </Text>
        </View>

        <Text style={styles.section}>Where you are signed in</Text>

        {devices.isError ? (
          <LoadFailed
            what="your devices"
            error={devices.error}
            onRetry={() => devices.refetch()}
            retrying={devices.isFetching}
          />
        ) : devices.isPending ? (
          <View style={styles.card}>
            <SkeletonListRow />
            <SkeletonListRow />
          </View>
        ) : (
          <View style={styles.card}>
            {list.map((s, i) => {
              const Icon = deviceIcon(s.device_name);
              return (
                <View key={s.id} style={[styles.device, i > 0 && styles.divided]}>
                  <View style={[styles.deviceIcon, s.is_current && styles.deviceIconOn]}>
                    <Icon
                      size={18}
                      color={s.is_current ? c.onPrimary : c.textSecondary}
                      strokeWidth={2.1}
                    />
                  </View>
                  <View style={styles.deviceCopy}>
                    <Text style={styles.deviceName} numberOfLines={1}>
                      {s.device_name}
                      {s.is_current ? " · this phone" : ""}
                    </Text>
                    <Text style={styles.deviceMeta}>{lastSeen(s.last_used_at)}</Text>
                  </View>
                  {/*
                    No button on the device you are holding. Signing this one
                    out from here is the Log out on the account page, and
                    offering it twice under two different words is how somebody
                    ends up pressing the one that also means something else.
                  */}
                  {!s.is_current && (
                    <Touchable
                      style={styles.revoke}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Sign out ${s.device_name}`}
                      onPress={() => askRevoke(s)}
                    >
                      <Text style={styles.revokeText}>Sign out</Text>
                    </Touchable>
                  )}
                </View>
              );
            })}

            {list.length === 0 && (
              <Text style={styles.empty}>Only this phone.</Text>
            )}
          </View>
        )}

        <Touchable
          style={styles.everywhere}
          accessibilityRole="button"
          accessibilityLabel="Sign out everywhere"
          onPress={askEverywhere}
        >
          <LogOut size={17} color={c.error} strokeWidth={2.2} />
          <Text style={styles.everywhereText}>
            {everywhere.isPending ? "Signing out…" : "Sign out everywhere"}
          </Text>
        </Touchable>
        <Text style={styles.rule}>
          Ends every session including this one. Use it if you think somebody
          else has your password.
        </Text>
      </KeyboardScreen>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, paddingBottom: spacing.xxl, gap: 0 },

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
      padding: spacing.md,
      gap: spacing.sm,
    },
    rule: { ...typography.tiny, color: c.textMuted, lineHeight: 16 },

    errorBox: {
      backgroundColor: c.errorBg,
      borderRadius: radius.md,
      padding: spacing.sm,
    },
    errorText: { ...typography.small, color: c.error },

    device: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
    divided: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm, marginTop: 2 },
    deviceIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    deviceIconOn: { backgroundColor: c.primary },
    deviceCopy: { flex: 1, gap: 1 },
    deviceName: { ...typography.label, color: c.text, fontSize: 14 },
    deviceMeta: { ...typography.tiny, color: c.textMuted },
    revoke: { paddingHorizontal: 10, paddingVertical: 6 },
    revokeText: { ...typography.tiny, color: c.error, fontWeight: "800" },
    empty: { ...typography.small, color: c.textMuted },

    everywhere: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
      paddingVertical: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    everywhereText: { ...typography.label, color: c.error, fontSize: 14 },
  });
