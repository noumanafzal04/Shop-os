import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, AtSign, BadgeCheck, Phone, UserRound } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { toast } from "../../../common/ui/toast";
import { ApiError } from "../../../common/types/api";
import { apiPut } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import type { User } from "../../auth/types";

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

  const changed =
    name.trim() !== (user?.name ?? "") ||
    email.trim() !== (user?.email ?? "") ||
    phone.trim() !== (user?.phone ?? "");

  const emailChanged = email.trim() !== (user?.email ?? "");
  const phoneChanged = phone.trim() !== (user?.phone ?? "");

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
        <Text style={styles.title}>Profile</Text>
      </View>

      <KeyboardScreen
        contentStyle={styles.content}
        footer={
          <View style={styles.bar}>
            <AppButton
              title={save.isPending ? "Saving…" : "Save changes"}
              onPress={() => save.mutate()}
              loading={save.isPending}
              disabled={!changed || name.trim().length < 2}
              size="lg"
            />
          </View>
        }
      >
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            {name.trim() ? (
              <Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase()}</Text>
            ) : (
              <UserRound size={30} color={c.onPrimary} strokeWidth={2} />
            )}
          </View>
          <Text style={styles.avatarHint}>
            Your initial is what shops and riders see beside your order.
          </Text>
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <AppTextInput
          label="Full name"
          icon={UserRound}
          placeholder="Your name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

        <View style={styles.field}>
          <AppTextInput
            label="Email"
            icon={AtSign}
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Mark
            verified={!!user?.email_verified && !emailChanged}
            changed={emailChanged}
            what="email"
          />
        </View>

        <View style={styles.field}>
          <AppTextInput
            label="Phone"
            icon={Phone}
            placeholder="03xx xxxxxxx"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <Mark
            verified={!!user?.phone_verified && !phoneChanged}
            changed={phoneChanged}
            what="phone number"
          />
        </View>

        <Text style={styles.note}>
          Your phone number is how a rider reaches you. Keep it one somebody can
          answer while an order is out.
        </Text>
      </KeyboardScreen>
    </SafeScreen>
  );
}

/** The verified tick, and the honest warning that replaces it mid-edit. */
function Mark({
  verified,
  changed,
  what,
}: {
  verified: boolean;
  changed: boolean;
  what: string;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  if (changed) {
    return (
      <Text style={styles.willUnverify}>
        Saving a new {what} means it has to be confirmed again.
      </Text>
    );
  }
  if (!verified) return null;
  return (
    <View style={styles.verified}>
      <BadgeCheck size={13} color={c.success} strokeWidth={2.4} />
      <Text style={styles.verifiedText}>Confirmed</Text>
    </View>
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

    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xs },

    avatarWrap: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
    avatar: {
      width: 74,
      height: 74,
      borderRadius: 37,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { ...typography.display, color: c.onPrimary, fontSize: 30 },
    avatarHint: { ...typography.tiny, color: c.textMuted, textAlign: "center" },

    field: { gap: 4 },
    verified: { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 2 },
    verifiedText: { ...typography.tiny, color: c.success, fontWeight: "700" },
    willUnverify: { ...typography.tiny, color: c.warning, paddingLeft: 2 },

    errorBox: {
      backgroundColor: c.errorBg,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    errorText: { ...typography.small, color: c.error },

    note: { ...typography.tiny, color: c.textMuted, marginTop: spacing.md, lineHeight: 16 },

    bar: {
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
  });
