import React from "react";
import { ActivityIndicator, Animated, Easing, Modal, StyleSheet, Text, View } from "react-native";
import { Bike, ShoppingBag } from "lucide-react-native";
import { spacing, type ThemeColors, typography, useColors } from "../../theme";
import { useModeStore } from "../../stores/modeStore";

/**
 * The cover held over a change of hats.
 *
 * ── Why anything is shown at all ─────────────────────────────────────
 *
 * Switching mode replaces the ENTIRE navigator: the tab bar, the stack, every
 * mounted screen. React Navigation unmounts one tree and mounts another, and
 * for a few frames that is visible as the old bar, then a blank, then a
 * different bar — which reads as the app glitching rather than as the app
 * doing what it was told.
 *
 * A cover with the destination's name on it turns those frames into an
 * intentional beat. It is not a spinner waiting on work; the work takes almost
 * no time. It is a statement that something deliberate is happening, and it is
 * the difference between "I switched" and "something broke".
 *
 * ── Why a Modal ──────────────────────────────────────────────────────
 *
 * It has to sit above the navigator it is covering, and the navigator is the
 * root. A Modal is the only layer in React Native that is genuinely above it
 * without threading an overlay through every screen.
 */
export function ModeSwitchCover() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const switching = useModeStore((s) => s.switching);
  const target = useModeStore((s) => s.target);

  const fade = React.useRef(new Animated.Value(0)).current;
  const lift = React.useRef(new Animated.Value(12)).current;

  React.useEffect(() => {
    if (!switching) {
      fade.setValue(0);
      lift.setValue(12);
      return;
    }
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(lift, {
        toValue: 0,
        damping: 14,
        stiffness: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [switching, fade, lift]);

  if (!switching) return null;

  const toRider = target === "rider";
  const Icon = toRider ? Bike : ShoppingBag;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.root, toRider && styles.rootRider]}>
        <Animated.View style={[styles.card, { opacity: fade, transform: [{ translateY: lift }] }]}>
          <View style={styles.disc}>
            <Icon size={30} color={toRider ? c.success : c.primary} strokeWidth={1.9} />
          </View>
          <Text style={styles.title}>{toRider ? "Rider mode" : "Shopping"}</Text>
          <Text style={styles.body}>
            {toRider
              ? "Setting up your deliveries…"
              : "Back to browsing shops…"}
          </Text>
          <ActivityIndicator color={toRider ? c.success : c.primary} style={styles.spinner} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      // Opaque, not a dim. The point is to HIDE the swap underneath, and a
      // translucent scrim would show the very tear it exists to cover.
      backgroundColor: c.bg,
    },
    rootRider: { backgroundColor: c.successBg },
    card: { alignItems: "center", gap: 6, paddingHorizontal: spacing.xl },
    disc: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    title: { ...typography.h3, color: c.text, fontSize: 19 },
    body: { ...typography.small, color: c.textSecondary, textAlign: "center" },
    spinner: { marginTop: spacing.md },
  });
