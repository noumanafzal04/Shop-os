import React from "react";
import { Animated, Easing, Pressable, StyleSheet, Text } from "react-native";
import { RotateCw } from "lucide-react-native";
import { radius, type ThemeColors, typography, useColors } from "../../theme";

/**
 * "This is how old what you are looking at is. Tap to ask again."
 *
 * ── Why a screen needs this at all ───────────────────────────────────
 *
 * Two screens in this app show something that changes while you watch it: a
 * customer following an order, and a rider watching a job board. Both poll,
 * because there is no websocket server in this product yet.
 *
 * A silent poll is worse than no poll. Somebody staring at "Preparing" cannot
 * tell whether the shop has not moved or the phone has not asked, and their
 * next move — close the app, reopen it, ring the shop — depends entirely on
 * which. So the age is stated, and the tap is there for the moment where
 * waiting fifteen seconds is not acceptable.
 *
 * ── The clock it trusts ──────────────────────────────────────────────
 *
 * `at` is the SERVER's timestamp, not the moment the response arrived. A
 * phone's clock can be minutes out and would then report a freshly loaded
 * screen as three minutes stale, or — worse — as being from the future.
 * Anything that arrives negative is shown as "just now", which is the honest
 * reading of a clock we cannot trust that far.
 */

interface Props {
  /** ISO timestamp from the server. */
  at?: string | null;
  busy?: boolean;
  onPress: () => void;
  /** Hide the words and keep the button — for a tight header. */
  compact?: boolean;
}

export function RefreshPill({ at, busy, onPress, compact }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const spin = React.useRef(new Animated.Value(0)).current;

  // A second-by-second re-render, and ONLY while there is something to count.
  // A screen with no timestamp yet must not run a timer for ever.
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (at == null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [at]);

  React.useEffect(() => {
    if (!busy) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Pressable
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Check for an update"
      hitSlop={8}
      onPress={onPress}
      disabled={busy}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <RotateCw size={14} color={c.textSecondary} strokeWidth={2.4} />
      </Animated.View>
      {!compact && (
        <Text style={styles.text} numberOfLines={1}>
          {busy ? "Checking…" : ago(at)}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * How long ago, in words somebody reads at a glance.
 *
 * Exported because it is the thing worth testing: the boundaries between
 * "just now", seconds, minutes and hours are where a clock skew or an
 * off-by-one shows up, and none of that is visible through a Pressable.
 */
export function ago(at?: string | null): string {
  if (at == null) return "Not checked yet";

  const then = Date.parse(at);
  if (Number.isNaN(then)) return "Not checked yet";

  const seconds = Math.floor((Date.now() - then) / 1000);

  // Negative means the phone's clock is behind the server's. We know the data
  // is fresh — it just arrived — so say so rather than "in 4 seconds".
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : "A while ago";
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    pressed: { opacity: 0.6 },
    text: { ...typography.tiny, color: c.textSecondary, fontWeight: "600", fontSize: 11 },
  });
