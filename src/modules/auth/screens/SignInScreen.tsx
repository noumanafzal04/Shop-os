import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  EnvelopeIcon,
  LockIcon,
  WarningIcon,
} from "../../../common/ui/icons";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { Touchable } from "../../../common/ui/Touchable";
import { ApiError } from "../../../common/types/api";
import { radius, spacing, type ThemeColors, useColors } from "../../../theme";
import { useLogin } from "../hooks/useAuth";
import { AuthScreen } from "../components/AuthScreen";
import { leaveAuth } from "../leaveAuth";

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
  const dismiss = () => leaveAuth(navigation);

  const submit = () => {
    if (!identifier.trim() || !password) return;
    login.mutate({ identifier: identifier.trim(), password }, { onSuccess: dismiss });
  };

  return (
    <AuthScreen mode="SignIn" title="Welcome back" subtitle="Log in to order and follow your deliveries.">
      {errorMessage && (
        <View style={styles.errorBox}>
          <WarningIcon size={16} color={c.error} />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      <View style={styles.form}>
        <AppTextInput
          label="Email or phone"
          icon={EnvelopeIcon}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={identifier}
          onChangeText={setIdentifier}
        />
        <AppTextInput
          label="Password"
          icon={LockIcon}
          placeholder="Enter your password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        {/* The way back for a forgotten password — the server always had one. */}
        <Touchable
          hitSlop={8}
          style={styles.forgot}
          accessibilityRole="button"
          accessibilityLabel="Forgot password"
          onPress={() => navigation.navigate("ForgotPassword", { identifier: identifier.trim() || undefined })}
        >
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Touchable>

        <AppButton
          // The same word as the tab above it: "Log in" there, "Log in" here.
          title="Log in"
          onPress={submit}
          loading={login.isPending}
          disabled={!identifier.trim() || !password}
          size="lg"
          style={styles.submit}
        />
      </View>

    </AuthScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    form: { gap: spacing.xs },
    submit: { marginTop: spacing.sm },
    forgot: { alignSelf: "flex-end", paddingVertical: 4 },
    forgotText: { color: c.primary, fontSize: 14, lineHeight: 18, fontWeight: "700" },

    errorBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: c.errorBg,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    errorText: { color: c.error, fontSize: 13, lineHeight: 18, flex: 1 },
  });
