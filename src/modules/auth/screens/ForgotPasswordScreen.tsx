import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { EnvelopeIcon, KeyIcon, LockIcon } from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { Touchable } from "../../../common/ui/Touchable";
import { toast } from "../../../common/ui/toast";
import { ApiError } from "../../../common/types/api";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { authService } from "../services/authService";
import { resetReady } from "../resetPassword";

/**
 * FORGOT PASSWORD — two steps, one screen.
 *
 * "Login and signup b" — the log-in form had no way back for somebody who
 * forgot their password, although the server has had one all along
 * (`/auth/otp/request` with `password_reset`, then `/auth/password/reset`).
 *
 *   1. Email or phone → a six-digit code is sent. The server answers the
 *      same whether or not the account exists, and so does this screen: it
 *      must never tell a stranger which addresses have accounts.
 *   2. The code and the new password twice → back to Log in, with the
 *      identifier already filled in.
 */
export function ForgotPasswordScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const [identifier, setIdentifier] = React.useState<string>(route.params?.identifier ?? "");
  const [sent, setSent] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [again, setAgain] = React.useState("");

  const send = useMutation({
    mutationFn: () => authService.requestOtp(identifier.trim(), "password_reset"),
    meta: { silent: true },
    onSuccess: (res) => {
      setSent(true);
      // A debug server hands the code back; a phone test build fills it in.
      const debug = res?.data?.debug_code;
      if (debug) setCode(String(debug));
    },
  });

  const reset = useMutation({
    mutationFn: () =>
      authService.resetPassword({
        identifier: identifier.trim(),
        code: code.trim(),
        password,
        password_confirmation: again,
      }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Password changed", { detail: "Log in with your new password." });
      navigation.goBack();
    },
  });

  const failure = (sent ? reset.error : send.error) ?? null;
  const error =
    failure instanceof ApiError
      ? (failure.firstFieldError() ?? failure.message)
      : failure
        ? "Something went wrong. Please try again."
        : null;

  const ready = resetReady({ code, password, again });

  return (
    <SafeScreen backgroundColor={c.bg}>
      <ScreenHeader title="Forgot password" subtitle={sent ? "Enter the code and a new password" : "We will send you a code"} />

      <KeyboardScreen contentStyle={styles.body}>
        <View style={styles.card}>
          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <AppTextInput
            label="Email or phone"
            icon={EnvelopeIcon}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={identifier}
            onChangeText={(t) => {
              setIdentifier(t);
              // A different address is a new request — the old code was not for it.
              if (sent) {
                setSent(false);
                setCode("");
              }
            }}
            editable={!reset.isPending}
          />

          {!sent ? (
            <AppButton
              title="Send code"
              onPress={() => send.mutate()}
              loading={send.isPending}
              disabled={identifier.trim().length < 3}
              size="lg"
            />
          ) : (
            <>
              {/* Never "we found your account": the server does not say, and nor do we. */}
              <Text style={styles.note}>
                If an account uses {identifier.trim()}, a 6-digit code is on its way.
              </Text>
              <AppTextInput
                label="Code"
                icon={KeyIcon}
                placeholder="6 digits"
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, ""))}
              />
              <AppTextInput
                label="New password"
                icon={LockIcon}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                textContentType="newPassword"
              />
              <AppTextInput
                label="New password again"
                icon={LockIcon}
                secureTextEntry
                value={again}
                onChangeText={setAgain}
                autoCapitalize="none"
                textContentType="newPassword"
                error={again.length > 0 && again !== password ? "The two do not match." : null}
              />
              <Text style={styles.note}>At least 8 characters.</Text>
              <AppButton
                title="Set new password"
                onPress={() => reset.mutate()}
                loading={reset.isPending}
                disabled={!ready}
                size="lg"
              />
              <Touchable
                hitSlop={8}
                style={styles.resend}
                accessibilityRole="button"
                accessibilityLabel="Send the code again"
                onPress={() => send.mutate()}
                disabled={send.isPending}
              >
                <Text style={styles.resendText}>{send.isPending ? "Sending…" : "Send the code again"}</Text>
              </Touchable>
            </>
          )}
        </View>
      </KeyboardScreen>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.xs,
    },
    note: { ...typography.small, color: c.textSecondary, marginBottom: spacing.sm },
    errorBox: { backgroundColor: c.errorBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
    errorText: { color: c.error, fontSize: 13, lineHeight: 18 },
    resend: { alignSelf: "center", paddingVertical: spacing.sm, marginTop: spacing.xs },
    resendText: { ...typography.label, color: c.primary, fontSize: 14, lineHeight: 18 },
  });
