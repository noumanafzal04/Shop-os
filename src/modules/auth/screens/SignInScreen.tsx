import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { AlertCircle, AtSign, Lock } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { ApiError } from "../../../common/types/api";
import { BRAND } from "../../../common/brand";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useLogin } from "../hooks/useAuth";

/**
 * Signing in.
 *
 * ── Flat, not a card ──────────────────────────────────────────────────
 *
 * The form used to sit in a white card, floated on a white page, under a
 * badge and a wordmark and a tagline. A card is a device for separating one
 * thing from the OTHER things around it — and on a screen that contains
 * nothing else, it separates the form from empty space, which is a border
 * drawn around the only object in the room.
 *
 * It also cost the form two inset gutters of its own on a screen where width
 * is the scarce thing, and it put a shadow between the fields and the page
 * that a keyboard then slid underneath.
 *
 * So: the page IS the form. One heading that says what this screen is for,
 * the fields at full width, and the button under them.
 */
export function SignInScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  const errorMessage =
    login.error instanceof ApiError
      ? login.error.firstFieldError() ?? login.error.message
      : login.error
        ? "Something went wrong. Please try again."
        : null;

  /**
   * Close the sheet once the session is real.
   *
   * Guest and customer share ONE navigator — that is what lets somebody sign in
   * at checkout and come back to their own checkout instead of a home screen.
   * The cost is that signing in no longer swaps the tree, so nothing dismisses
   * this modal by itself: the store flips, the screen stays, and it looks like
   * the button did nothing.
   *
   * `canGoBack` because this screen is also reachable as the only thing on the
   * stack, where there is nothing to go back to.
   */
  const dismiss = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  const submit = () => {
    if (!identifier.trim() || !password) return;
    login.mutate({ identifier: identifier.trim(), password }, { onSuccess: dismiss });
  };

  return (
    <SafeScreen backgroundColor={c.bg}>
      <KeyboardScreen contentStyle={styles.content}>
        <View style={styles.head}>
          <Text style={styles.wordmark}>{BRAND.name}</Text>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.sub}>Sign in to order and follow your deliveries.</Text>
        </View>

        {errorMessage && (
          <View style={styles.errorBox}>
            <AlertCircle size={16} color={c.error} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <View style={styles.form}>
          <AppTextInput
            label="Email or phone"
            icon={AtSign}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={identifier}
            onChangeText={setIdentifier}
          />
          <AppTextInput
            label="Password"
            icon={Lock}
            placeholder="Enter your password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          <AppButton
            title="Sign in"
            onPress={submit}
            loading={login.isPending}
            disabled={!identifier.trim() || !password}
            size="lg"
            style={styles.submit}
          />
        </View>

        <View style={styles.footer}>
          <Pressable onPress={() => navigation.navigate("SignUp")} hitSlop={8}>
            <Text style={styles.footerText}>
              New here? <Text style={styles.footerAccent}>Create an account</Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardScreen>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    content: { padding: spacing.lg, justifyContent: "center", flexGrow: 1 },

    head: { marginBottom: spacing.xl },
    // The name, small and in the brand's colour — it identifies the app
    // without competing with the sentence that says what to do here.
    wordmark: {
      ...typography.label,
      color: c.primary,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      marginBottom: spacing.sm,
    },
    title: { ...typography.display, color: c.text },
    sub: { ...typography.body, color: c.textSecondary, marginTop: 6 },

    form: { gap: spacing.xs },
    submit: { marginTop: spacing.md },

    errorBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: c.errorBg,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    errorText: { color: c.error, fontSize: 13, flex: 1 },

    footer: { alignItems: "center", marginTop: spacing.xl },
    footerText: { ...typography.body, color: c.textSecondary },
    footerAccent: { color: c.primary, fontWeight: "700" },
  });
