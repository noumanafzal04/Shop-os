import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { ApiError } from "../../../common/types/api";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useRegisterCustomer } from "../../marketplace/hooks/useMarketplace";
import { AuthScreen } from "../components/AuthScreen";
import { leaveAuth, switchAuth } from "../leaveAuth";
import { EnvelopeIcon, LockIcon, PersonIcon, PhoneIcon } from "../../../common/ui/icons";

/**
 * CUSTOMER registration — business accounts are created by the platform
 * admin. On success the store flips to authenticated and navigation shows
 * the customer experience automatically.
 */
export function SignUpScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const register = useRegisterCustomer();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const apiError = register.error instanceof ApiError ? register.error : null;
  const errorFor = (key: string) => apiError?.errors[key]?.[0] ?? null;
  const generalError =
    apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  /**
   * Close the sheet once the account exists — see `SignInScreen` for why
   * nothing does this on its own now that guest and customer share one
   * navigator. Registering signs the person straight in, so there is nothing
   * left for this screen to do.
   */
  const dismiss = () => leaveAuth(navigation);

  const submit = () => {
    if (register.isPending) return;
    register.mutate(
      {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password,
        password_confirmation: password,
      },
      { onSuccess: dismiss },
    );
  };

  return (
    <AuthScreen title="Create your account" subtitle="One account for every shop near you — order, track and reorder.">

        {generalError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{generalError}</Text>
          </View>
        )}

        <AppTextInput
          label="Full name"
          icon={PersonIcon}
          placeholder="Your name"
          value={name}
          onChangeText={setName}
          error={errorFor("name")}
        />
        <AppTextInput
          label="Email"
          icon={EnvelopeIcon}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          error={errorFor("email")}
        />
        <AppTextInput
          label="Phone"
          icon={PhoneIcon}
          placeholder="+92…"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          error={errorFor("phone")}
        />
        <AppTextInput
          label="Password"
          icon={LockIcon}
          placeholder="Min. 8 characters"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          error={errorFor("password")}
        />

        <AppButton
          title="Create account"
          onPress={submit}
          loading={register.isPending}
          disabled={!name.trim() || !password || (!email.trim() && !phone.trim())}
          size="lg"
          style={{ marginTop: spacing.sm }}
        />

        <Pressable onPress={() => switchAuth(navigation, "SignIn")} style={styles.footerLink}>
          <Text style={styles.footerText}>
            Already have an account? <Text style={styles.footerAccent}>Sign in</Text>
          </Text>
        </Pressable>
    </AuthScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
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
  footerLink: { marginTop: spacing.lg, alignItems: "center" },
  footerText: { ...typography.body, color: c.gray[500] },
  footerAccent: { color: c.brand[500], fontWeight: "600" },
});
