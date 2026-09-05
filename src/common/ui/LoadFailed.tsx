import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { CloudOff, RefreshCw } from "lucide-react-native";
import { AppButton } from "./AppButton";
import { useTheme } from "../../theme";
import { ApiError } from "../types/api";

/**
 * What a screen shows when the request for its contents failed.
 *
 * ── Why this is not the same as "nothing here" ────────────────────────
 *
 * Nine screens had a loading state and an empty state and NOTHING in between,
 * so a failed request fell through to the empty one. A shopper whose connection
 * dropped for a second was told, in the app's own confident voice:
 *
 *     "No shops around here yet."
 *
 * That is not a smaller version of the truth, it is a different claim — one
 * about the whole platform rather than about one request — and there is no
 * retry on it, because why would you retry a fact.
 *
 * So: say the request failed, say it plainly, and put the retry where the hand
 * already is.
 */
export function LoadFailed({
  what,
  error,
  onRetry,
  retrying = false,
}: {
  /** What could not be loaded, lower case: "shops near you", "your orders". */
  what: string;
  error?: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const { colors: c, radius, spacing, typography } = useTheme();

  // The server's own words when it bothered to send any, because "something
  // went wrong" is what an app says when it did not read the reply. A 500 has
  // nothing worth repeating, so only a real message is passed on.
  const detail =
    error instanceof ApiError && error.status > 0 && error.status < 500 ? error.message : null;

  return (
    <View style={[styles.wrap, { padding: spacing.lg }]}>
      <View
        style={[
          styles.icon,
          { backgroundColor: c.surfaceAlt, borderRadius: radius.lg, marginBottom: spacing.md },
        ]}
      >
        <CloudOff size={26} color={c.textMuted} strokeWidth={1.9} />
      </View>

      <Text style={[typography.label, styles.center, { color: c.text }]}>
        Couldn&rsquo;t load {what}
      </Text>
      <Text
        style={[typography.small, styles.center, { color: c.textSecondary, marginTop: 4 }]}
      >
        {detail ?? "Check your connection and try again."}
      </Text>

      <AppButton
        title="Try again"
        variant="outline"
        icon={RefreshCw}
        onPress={onRetry}
        loading={retrying}
        style={{ marginTop: spacing.lg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", paddingVertical: 48 },
  icon: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
});
