import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { AtSign, Lock, Store, AlertCircle } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { ApiError } from "../../../common/types/api";
import { colors, radius, shadow, spacing, typography } from "../../../theme";
import { useLogin } from "../hooks/useAuth";

export function SignInScreen() {
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

  const submit = () => {
    if (!identifier.trim() || !password) return;
    login.mutate({ identifier: identifier.trim(), password });
  };

  return (
    <SafeScreen backgroundColor={colors.bg}>
      <KeyboardScreen contentStyle={styles.content}>
        <View style={styles.brandWrap}>
          <View style={styles.logo}>
            <Store size={30} color={colors.white} strokeWidth={2.2} />
          </View>
          <Text style={styles.brand}>ShopOS</Text>
          <Text style={styles.tagline}>Run your business. Sell everywhere.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Welcome back</Text>
          <Text style={styles.cardSub}>Sign in to your account</Text>

          {errorMessage && (
            <View style={styles.errorBox}>
              <AlertCircle size={16} color={colors.error} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <AppTextInput
            label="Email or phone"
            icon={AtSign}
            placeholder="you@business.com"
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
            style={{ marginTop: spacing.xs }}
          />
        </View>

        <View style={styles.footer}>
          <Pressable onPress={() => navigation.navigate("SignUp")}>
            <Text style={styles.footerText}>
              New here? <Text style={styles.footerAccent}>Create an account</Text>
            </Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate("Market")} style={styles.guestBtn}>
            <Text style={styles.guestText}>Browse shops as guest →</Text>
          </Pressable>
        </View>
      </KeyboardScreen>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, justifyContent: "center", flexGrow: 1 },
  brandWrap: { alignItems: "center", marginBottom: spacing.xl },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.brand[500],
    alignItems: "center",
    justifyContent: "center",
    ...shadow.md,
  },
  brand: { ...typography.display, color: colors.gray[900], marginTop: spacing.md },
  tagline: { ...typography.small, color: colors.gray[500], marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.lg,
  },
  cardTitle: { ...typography.title, fontSize: 20, color: colors.gray[900] },
  cardSub: { ...typography.small, color: colors.gray[500], marginTop: 2, marginBottom: spacing.lg },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.errorBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.error, fontSize: 13, flex: 1 },
  footer: { alignItems: "center", marginTop: spacing.xl, gap: spacing.md },
  footerText: { ...typography.body, color: colors.gray[500] },
  footerAccent: { color: colors.brand[600], fontWeight: "700" },
  guestBtn: {
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  guestText: { ...typography.label, color: colors.gray[600] },
});
