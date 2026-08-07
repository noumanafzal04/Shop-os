import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { ApiError } from "../../../common/types/api";
import { colors, spacing, typography } from "../../../theme";
import { useRegisterCustomer } from "../../marketplace/hooks/useMarketplace";

/**
 * CUSTOMER registration — business accounts are created by the platform
 * admin. On success the store flips to authenticated and navigation shows
 * the customer experience automatically.
 */
export function SignUpScreen() {
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

  const submit = () => {
    if (register.isPending) return;
    register.mutate({
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      password,
      password_confirmation: password,
    });
  };

  return (
    <SafeScreen>
      <KeyboardScreen contentStyle={styles.content}>
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Shop from local businesses in your city.</Text>

        {generalError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{generalError}</Text>
          </View>
        )}

        <AppTextInput
          label="Full name *"
          placeholder="Your name"
          value={name}
          onChangeText={setName}
          error={errorFor("name")}
        />
        <AppTextInput
          label="Email"
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          error={errorFor("email")}
        />
        <AppTextInput
          label="Phone (email or phone required)"
          placeholder="+92…"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          error={errorFor("phone")}
        />
        <AppTextInput
          label="Password *"
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
          style={{ marginTop: spacing.sm }}
        />

        <Pressable onPress={() => navigation.navigate("SignIn")} style={styles.footerLink}>
          <Text style={styles.footerText}>
            Already have an account? <Text style={styles.footerAccent}>Sign in</Text>
          </Text>
        </Pressable>
      </KeyboardScreen>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, justifyContent: "center" },
  title: { ...typography.title, color: colors.gray[900] },
  subtitle: {
    ...typography.subtitle,
    color: colors.gray[500],
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  errorBox: {
    backgroundColor: "#fef3f2",
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.error, fontSize: 13 },
  footerLink: { marginTop: spacing.lg, alignItems: "center" },
  footerText: { ...typography.body, color: colors.gray[500] },
  footerAccent: { color: colors.brand[500], fontWeight: "600" },
});
