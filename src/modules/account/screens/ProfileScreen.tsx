import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { KeyboardScreen } from "@cartze/core/ui/KeyboardScreen";
import { AppButton } from "@cartze/core/ui/AppButton";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { toast } from "@cartze/core/ui/toast";
import { EnvelopeIcon, LockIcon, PersonIcon, PhoneIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { ApiError } from "@cartze/core/types/api";
import { authService } from "../../auth/services/authService";
import { useAuthStore } from "../../../stores/authStore";

/**
 * YOUR OWN DETAILS — not the shop's.
 *
 * Shop settings are a different screen behind a different permission. This
 * one is about the PERSON, so a cashier reaches it on the same terms the
 * owner does: everybody is allowed to fix the spelling of their own name.
 *
 * ── Two forms, one screen, and they do not share a button ────────────
 *
 * Changing a name and changing a password are different operations with
 * different failure modes, and the server has two endpoints. One Save that
 * did both would have to decide what "the name saved but the password did
 * not" looks like. Two buttons never have to.
 */
export function ProfileScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();
  const user = useAuthStore((st) => st.user);
  const setUser = useAuthStore((st) => st.setUser);

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);

  /**
   * Trimmed, and an empty box becomes NULL rather than "".
   *
   * The server's rule is `nullable|email`, and "" is not a valid email — so
   * clearing the field would fail validation with a message about the format
   * of something the person deliberately left blank.
   */
  const profile = useMutation({
    mutationFn: () =>
      authService.updateProfile({
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
      }),
    onSuccess: (res) => {
      setFieldErrors({});
      // The store, not just the screen: the account page, the drawer header
      // and the device name all read `user.name`, and a save that updates
      // one of them is a save that looks half-applied.
      setUser(res.data);
      toast.success("Saved");
    },
    onError: (e: unknown) => {
      /*
        FIELD ERRORS GO ON THEIR FIELDS. A toast saying "That email is
        already used by another account" over a form with three boxes makes
        the person guess which one — and the server already said.
      */
      const errors = e instanceof ApiError ? e.errors : null;
      if (errors && Object.keys(errors).length > 0) {
        setFieldErrors(
          Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, v[0] ?? ""])),
        );
        return;
      }
      toast.error(e instanceof ApiError ? e.message : "Could not save your details");
    },
  });

  const password = useMutation({
    mutationFn: () => authService.changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwError(null);
      toast.success("Password changed");
    },
    onError: (e: unknown) => {
      setPwError(e instanceof ApiError ? e.message : "Could not change your password");
    },
  });

  const contactChanged =
    (user?.email ?? "") !== email.trim() || (user?.phone ?? "") !== phone.trim();

  const submitPassword = () => {
    // Checked HERE as well as on the server, because the server's answer to a
    // mismatch costs a round trip to learn something this screen already
    // knows. The server still checks; this is not a substitute for it.
    if (next !== confirm) {
      setPwError("The two new passwords do not match.");
      return;
    }
    if (next.length < 8) {
      setPwError("A new password needs at least 8 characters.");
      return;
    }
    setPwError(null);
    password.mutate();
  };

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader title="Your details" onBack={() => nav.goBack()} />

      <KeyboardScreen contentStyle={s.body}>
        <View style={s.card}>
          <Text style={s.cardTitle}>About you</Text>

          <AppTextInput
            label="Name"
            icon={PersonIcon}
            value={name}
            onChangeText={setName}
            error={fieldErrors.name}
            autoCapitalize="words"
            placeholder="Your name"
          />
          <AppTextInput
            label="Email"
            icon={EnvelopeIcon}
            value={email}
            onChangeText={setEmail}
            error={fieldErrors.email}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Leave blank if you sign in by phone"
          />
          <AppTextInput
            label="Phone"
            icon={PhoneIcon}
            value={phone}
            onChangeText={setPhone}
            error={fieldErrors.phone}
            keyboardType="phone-pad"
            placeholder="03xx xxxxxxx"
          />

          {/*
            SAID BEFORE THE BUTTON IS PRESSED, not after.

            `updateProfile` clears `email_verified_at` / `phone_verified_at`
            when either changes. That is correct — a new address has not been
            verified — and it is also the kind of thing somebody should be
            told while they can still change their mind.
          */}
          {contactChanged ? (
            <Text style={s.warn}>
              Changing your email or phone means it has to be verified again.
            </Text>
          ) : null}

          <AppButton
            title="Save"
            size="lg"
            loading={profile.isPending}
            disabled={name.trim().length < 2}
            onPress={() => profile.mutate()}
          />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Password</Text>

          <AppTextInput
            label="Current password"
            icon={LockIcon}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoCapitalize="none"
          />
          <AppTextInput
            label="New password"
            icon={LockIcon}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoCapitalize="none"
          />
          <AppTextInput
            label="New password again"
            icon={LockIcon}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            error={pwError ?? undefined}
          />

          {/*
            THE CONSEQUENCE, STATED. The server logs every other session out
            on a password change. A shopkeeper whose till signs itself out
            mid-shift without warning will conclude the app broke.
          */}
          <Text style={s.warn}>
            Changing this signs you out everywhere else, including the till.
          </Text>

          <AppButton
            title="Change password"
            variant="outline"
            size="lg"
            loading={password.isPending}
            disabled={!current || !next || !confirm}
            onPress={submitPassword}
          />
        </View>
      </KeyboardScreen>
    </SafeScreen>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
    card: {
      backgroundColor: c.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    cardTitle: { ...typography.label, color: c.textSecondary, marginBottom: 2 },
    warn: { ...typography.small, color: c.warning },
  });
