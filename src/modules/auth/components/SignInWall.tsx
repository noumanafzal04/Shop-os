import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { type LucideIcon } from "lucide-react-native";
import { AppButton } from "../../../common/ui/AppButton";
import { useTheme } from "../../../theme";

/**
 * What a guest sees where an account is needed.
 *
 * The app browses without one on purpose — shops, menus, prices, a basket. An
 * account is asked for at the two points where it is genuinely required: an
 * order has to belong to somebody, and so does an order history.
 *
 * ── Why this is a panel and not a redirect ────────────────────────────
 *
 * Sending a guest to a sign-in SCREEN loses where they were. Someone who filled
 * a basket, tapped checkout, and got a login form has been asked to do
 * paperwork before being told why — and after signing in they arrive somewhere
 * that is not their basket. This says what is needed and why, in place, with
 * everything they built still behind it.
 */
export function SignInWall({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  /** Why an account is needed HERE — never a generic "please sign in". */
  message: string;
}) {
  const navigation = useNavigation<{ navigate: (screen: string) => void }>();
  const { colors: c, radius, spacing, typography } = useTheme();

  return (
    <View style={[styles.wrap, { padding: spacing.lg }]}>
      <View
        style={[
          styles.icon,
          { backgroundColor: c.primarySoft, borderRadius: radius.lg, marginBottom: spacing.lg },
        ]}
      >
        <Icon size={30} color={c.primary} strokeWidth={1.9} />
      </View>

      <Text style={[typography.title, styles.center, { color: c.text, marginBottom: spacing.sm }]}>
        {title}
      </Text>
      <Text
        style={[typography.body, styles.center, { color: c.textSecondary, marginBottom: spacing.lg }]}
      >
        {message}
      </Text>

      <View style={[styles.actions, { gap: spacing.sm }]}>
        <AppButton title="Sign in" size="lg" onPress={() => navigation.navigate("SignIn")} />
        <AppButton
          title="Create an account"
          variant="outline"
          size="lg"
          onPress={() => navigation.navigate("SignUp")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  icon: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  actions: { alignSelf: "stretch" },
});
