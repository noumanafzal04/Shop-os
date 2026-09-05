import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Monitor } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { BRAND } from "../../../common/brand";
import { useColors } from "../../../theme";
import { radius, spacing, typography } from "../../../theme";
import { useLogout } from "../hooks/useAuth";

/**
 * A shop's account signed into the shoppers' app.
 *
 * This app is for CUSTOMERS and RIDERS. A shop is run from the web panel,
 * which is a PWA — it installs to a home screen, and it keeps selling with no
 * network. Building a second way to run a shop would be a second place for
 * every till rule to drift out of step with the first.
 *
 * So the answer to a business account here is a sentence and a way out, not a
 * dead tab bar. Signing in still SUCCEEDED — the credentials were right and the
 * session is real — which is why this is a screen inside the app and not a
 * login error: telling someone their password is wrong when it is correct
 * sends them to reset a password that never needed resetting.
 */
export function BusinessAccountScreen() {
  const c = useColors();
  const logout = useLogout();

  return (
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.wrap}>
        <View style={[styles.icon, { backgroundColor: c.surfaceAlt }]}>
          <Monitor size={30} color={c.textSecondary} strokeWidth={2} />
        </View>

        <Text style={[typography.title, styles.title, { color: c.text }]}>
          This app is for shopping
        </Text>

        <Text style={[typography.body, styles.body, { color: c.textSecondary }]}>
          You are signed in with a business account. Open {BRAND.domain} on a
          phone or computer to run your shop — the till works there even with no
          internet, and it installs to your home screen like an app.
        </Text>

        <Text style={[typography.small, styles.body, { color: c.textMuted }]}>
          To shop or deliver here instead, sign out and create a personal
          account.
        </Text>

        <View style={styles.actions}>
          <AppButton
            title={`Open ${BRAND.domain}`}
            onPress={() => {
              // No browser, or a URL the OS will not take: the sign-out button
              // below is still the way out, so this must not throw past it.
              Linking.openURL(`https://${BRAND.domain}`).catch(() => {});
            }}
            size="lg"
          />
          <AppButton
            title="Sign out"
            variant="outline"
            onPress={() => logout.mutate()}
            loading={logout.isPending}
            size="lg"
          />
        </View>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { textAlign: "center", marginBottom: spacing.sm },
  body: { textAlign: "center", marginBottom: spacing.md },
  actions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.lg },
});
