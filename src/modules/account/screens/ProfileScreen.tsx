import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import {
  BadgeCheckIcon,
  ChevronRightIcon,
  EnvelopeIcon,
  InfoIcon,
  LockIcon,
  PersonIcon,
  PhoneIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { toast } from "../../../common/ui/toast";
import { ApiError } from "../../../common/types/api";
import { apiPut } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import type { User } from "../../auth/types";
import { initials, isChanged, profileErrors } from "../profileForm";

/**
 * Your own name and contact details.
 *
 * ── Why this screen had to exist ─────────────────────────────────────
 *
 * The app could READ a profile and never change one. Somebody who mistyped
 * their name at sign-up carried it for ever, and a changed phone number — the
 * thing a rider calls — could only be corrected by whoever had database
 * access. There was no endpoint either; `PUT /auth/profile` was added with it.
 *
 * ── The verified marks ───────────────────────────────────────────────
 *
 * A tick beside an address means "we sent a code there and somebody read it".
 * Changing the address drops it, on the server, because otherwise the system
 * would claim to have verified something it has never contacted. The screen
 * says so BEFORE you save rather than letting the tick vanish afterwards.
 */
export function ProfileScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();

  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiPut<User>("/auth/profile", {
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
        })
      ).data,
    // Handled here rather than by the global toast, because a field error
    // belongs beside the field's own screen.
    meta: { silent: true },
    onSuccess: (updated) => {
      setUser(updated);
      toast.success("Profile saved");
      if (navigation.canGoBack()) navigation.goBack();
    },
  });

  const error =
    save.error instanceof ApiError
      ? (save.error.firstFieldError() ?? save.error.message)
      : save.error
        ? "Could not save. Please try again."
        : null;

  const changed = isChanged({ name, email, phone }, user ?? {});
  const problems = profileErrors({ name, email, phone });
  const valid = Object.keys(problems).length === 0;
  // A field speaks once it has been touched — not a wall of red on arrival.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (k: string) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const shown = (k: keyof typeof problems) => (touched[k] ? problems[k] : undefined);

  const emailChanged = email.trim() !== (user?.email ?? "");
  const phoneChanged = phone.trim() !== (user?.phone ?? "");

  return (
    <SafeScreen backgroundColor={c.bg}>
      <ScreenHeader title="Edit profile" />

      <KeyboardScreen
        contentStyle={styles.content}
        footer={
          <View style={styles.bar}>
            <AppButton
              title={save.isPending ? "Saving…" : "Save changes"}
              onPress={() => save.mutate()}
              loading={save.isPending}
              disabled={!changed || !valid || save.isPending}
              size="lg"
            />
          </View>
        }
      >
        {/* Who this is, as shops and riders will see it — it follows what you type. */}
        <View style={styles.card}>
          <View style={styles.avatar}>
            {initials(name) ? (
              <Text style={styles.avatarText}>{initials(name)}</Text>
            ) : (
              <PersonIcon size={30} color={c.onPrimary} />
            )}
          </View>
          <View style={styles.who}>
            <Text style={styles.whoName} numberOfLines={1}>
              {name.trim() || "Your name"}
            </Text>
            <Text style={styles.whoSub} numberOfLines={1}>
              {email.trim() || phone.trim() || "Add an email or phone"}
            </Text>
          </View>
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.section}>Personal details</Text>
        <View style={styles.group}>
          <AppTextInput
            label="Full name"
            icon={PersonIcon}
            placeholder="Your name"
            value={name}
            onChangeText={setName}
            onBlur={() => touch("name")}
            autoCapitalize="words"
            maxLength={255}
            error={shown("name")}
          />

          <View style={styles.field}>
            <AppTextInput
              label="Email"
              icon={EnvelopeIcon}
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              onBlur={() => touch("email")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              error={shown("email")}
              trailing={<Mark verified={!!user?.email_verified && !emailChanged} />}
            />
            {emailChanged && !!user?.email && <Text style={styles.willUnverify}>A new email has to be confirmed again.</Text>}
          </View>

          <View style={styles.field}>
            <AppTextInput
              label="Phone"
              icon={PhoneIcon}
              placeholder="0300 1234567"
              value={phone}
              onChangeText={setPhone}
              onBlur={() => touch("phone")}
              keyboardType="phone-pad"
              maxLength={20}
              error={shown("phone")}
              trailing={<Mark verified={!!user?.phone_verified && !phoneChanged} />}
            />
            {phoneChanged && !!user?.phone && (
              <Text style={styles.willUnverify}>A new number has to be confirmed again.</Text>
            )}
          </View>
        </View>

        <View style={styles.tip}>
          <InfoIcon size={16} color={c.primary} />
          <Text style={styles.tipText}>
            Your phone number is how a rider reaches you. Keep it one somebody can answer while an order is out.
          </Text>
        </View>

        <Text style={styles.section}>Sign-in</Text>
        <Pressable
          style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
          onPress={() => navigation.navigate("Security")}
          accessibilityRole="button"
          accessibilityLabel="Change password"
        >
          <View style={styles.linkIcon}>
            <LockIcon size={18} color={c.primary} />
          </View>
          <View style={styles.who}>
            <Text style={styles.linkTitle}>Change password</Text>
            <Text style={styles.linkSub}>And see the devices signed in</Text>
          </View>
          <ChevronRightIcon size={18} color={c.textMuted} />
        </Pressable>
      </KeyboardScreen>
    </SafeScreen>
  );
}

/** The verified tick, inside the field. Gone once the value changes (see the note under it). */
function Mark({ verified }: { verified: boolean }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  if (!verified) return null;
  return (
    <View style={styles.verified}>
      <BadgeCheckIcon size={13} color={c.success} />
      <Text style={styles.verifiedText}>Confirmed</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.lg },

    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.primarySoft,
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 31,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { ...typography.title, color: c.onPrimary, fontSize: 24, lineHeight: 30 },
    who: { flex: 1, gap: 2 },
    whoName: { ...typography.title, color: c.text, fontSize: 18, lineHeight: 24 },
    whoSub: { ...typography.small, color: c.textSecondary },

    section: {
      ...typography.tiny,
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontWeight: "700",
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    group: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },

    field: { marginBottom: spacing.xs },
    verified: { flexDirection: "row", alignItems: "center", gap: 4 },
    verifiedText: { ...typography.tiny, color: c.success, fontWeight: "700" },
    willUnverify: { ...typography.tiny, color: c.warning, marginTop: -spacing.sm, marginBottom: spacing.sm },

    errorBox: {
      backgroundColor: c.errorBg,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
    },
    errorText: { ...typography.small, color: c.error },

    tip: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "flex-start",
      marginTop: spacing.ms,
      paddingHorizontal: spacing.xs,
    },
    tipText: { ...typography.tiny, color: c.textMuted, lineHeight: 16, flex: 1 },

    link: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    linkPressed: { backgroundColor: c.surfaceAlt },
    linkIcon: {
      width: 38,
      height: 38,
      borderRadius: 13,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    linkTitle: { ...typography.label, color: c.text, fontSize: 15, lineHeight: 20 },
    linkSub: { ...typography.tiny, color: c.textMuted },

    bar: {
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
  });
