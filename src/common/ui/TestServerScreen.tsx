import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeScreen } from "./SafeScreen";
import { KeyboardScreen } from "./KeyboardScreen";
import { AppButton } from "./AppButton";
import { AppTextInput } from "./AppTextInput";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../theme";
import { LAN_PORT } from "../config";
import { connectTypedServer, searchTestServer, useTestServer } from "../testServer";

/**
 * WHERE IS THE SERVER — a phone TEST build only (`API_TARGET = "lan"`).
 *
 * Shown in front of the app while it looks for the computer on this Wi-Fi,
 * and when it could not find it. Two ways out: search again (the server was
 * just started), or type the address `backend/scripts/serve-lan.sh` printed.
 */
export function TestServerScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const state = useTestServer((s) => s.state);
  const last = useTestServer((s) => s.host);
  const [typed, setTyped] = useState(last ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const searching = state === "searching" || state === "checking";

  const connect = async () => {
    setBusy(true);
    setFailed(null);
    const ok = await connectTypedServer(typed);
    setBusy(false);
    if (!ok) setFailed(`Nothing answered at ${typed.trim() || "that address"}. Is the server running, and is this phone on the same Wi-Fi?`);
  };

  return (
    <SafeScreen edges={["top", "bottom"]}>
      <KeyboardScreen contentStyle={styles.page}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>TEST BUILD</Text>
          <Text style={styles.title}>Connect to your computer</Text>
          <Text style={styles.body}>
            On the computer, start the backend with backend/scripts/serve-lan.sh. Keep this phone on the same Wi-Fi —
            the app finds it by itself.
          </Text>

          {searching ? (
            <View style={styles.searching} accessibilityLiveRegion="polite">
              <ActivityIndicator color={c.primary} />
              <Text style={styles.body}>Looking on this Wi-Fi…</Text>
            </View>
          ) : (
            <>
              <AppButton title="Search again" variant="outline" onPress={() => searchTestServer()} />
              <Text style={styles.or}>or type the address it printed</Text>
              <AppTextInput
                label="Computer's address"
                value={typed}
                onChangeText={(t: string) => {
                  setTyped(t);
                  setFailed(null);
                }}
                placeholder={`192.168.1.5:${LAN_PORT}`}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                error={failed ?? undefined}
                onSubmitEditing={connect}
              />
              <AppButton title="Connect" onPress={connect} loading={busy} disabled={typed.trim() === ""} />
            </>
          )}
        </View>
      </KeyboardScreen>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: { flexGrow: 1, justifyContent: "center", padding: spacing.md, backgroundColor: c.bg },
    card: {
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    eyebrow: { ...typography.micro, color: c.primary, letterSpacing: 0.8 },
    title: { ...typography.title, color: c.text },
    body: { ...typography.small, color: c.textSecondary },
    searching: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
    or: { ...typography.caption, color: c.textMuted, textAlign: "center" },
  });
