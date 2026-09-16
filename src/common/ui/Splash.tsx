import React from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { BRAND } from "../brand";
import { CartIcon } from "./icons";
import { useTheme } from "../../theme";

/**
 * What the app shows while it works out who you are.
 *
 * ── Why this is not a spinner ─────────────────────────────────────────
 *
 * It was one: a bare `ActivityIndicator` on a white page, which is the same
 * thing every half-finished app shows and says nothing about which app you
 * opened. The window behind it was white too, so tapping the icon gave a white
 * flash, then a white page, then — abruptly — a coloured app.
 *
 * Now the launcher's own frame is the brand (`styles.xml`), this continues it,
 * and the first screen arrives in the same colour. Nothing flashes because
 * nothing changes colour.
 *
 * ── THE COLOUR IS THE MODE'S, and getting that wrong was the bug ──────
 *
 * This painted `brand[500]` — the RAW TOKEN — and the raw token is the ember
 * scale, which is what the WORKING side wears. The shopping side wears leaf
 * green (`ThemeProvider` decides, in one line). So a shopper tapped a green
 * icon, got an orange splash, and arrived in a green app: "splash py 2 colors
 * arhy".
 *
 * The first fix went the wrong way — it reached PAST the theme to the token,
 * on the reasoning that a screen shown before the mode is known cannot ask
 * about the mode. That reasoning is wrong twice over. The store has a mode at
 * every instant: it DEFAULTS to `customer`, which is the right answer for
 * almost everybody and the only answer a launcher icon can be painted for.
 * And once `hydrateMode` lands, a returning rider's last frame here is already
 * their own orange, which hands over to an orange app rather than tearing.
 *
 * So the ground is `c.primary`: green for a shopper, orange for a rider, and
 * the same value `styles.xml` gives the window for the default case.
 *
 * ── The animation ─────────────────────────────────────────────────────
 *
 * The name settles in — a small rise and a fade, once — and three dots breathe
 * underneath for as long as the wait lasts. The settle says "the app has
 * started"; the dots say "it is still working". Two different facts, so two
 * different motions, and only the second one repeats: a logo that keeps
 * re-animating reads as a stuck loop rather than as progress.
 */
export function Splash() {
  const { typography, spacing, colors: c } = useTheme();

  /**
   * The mode's own colour. See the note above: `c.primary` is leaf green on
   * the shopping side and ember orange on the working side, and the store
   * answers `customer` from the first frame rather than waiting.
   */
  const GROUND = c.primary;
  const ON_GROUND = c.onPrimary;
  const SOFT = c.brand[200];

  const enter = React.useRef(new Animated.Value(0)).current;
  const pulse = React.useRef(new Animated.Value(0)).current;
  const [still, setStill] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setStill(on);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (still) {
      enter.setValue(1);
      return;
    }

    const settle = Animated.timing(enter, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    const breathe = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );

    settle.start();
    breathe.start();

    return () => {
      settle.stop();
      breathe.stop();
    };
  }, [enter, pulse, still]);

  /**
   * Each dot peaks a third of a cycle after the one before it, so the row
   * reads as a wave rather than three lamps blinking together.
   *
   * Written as three fixed curves over one clock. The obvious version — phase
   * shifting by adding an offset and sorting — produces an `inputRange` that
   * is no longer strictly increasing on the wrap-around, which Animated
   * rejects at runtime rather than at build time.
   */
  const DIM = 0.25;
  const CURVES = [
    [1, DIM, DIM, 1],
    [DIM, 1, DIM, DIM],
    [DIM, DIM, 1, DIM],
  ];

  const dot = (index: number) =>
    still
      ? 0.6
      : pulse.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: CURVES[index] });

  return (
    <View style={[styles.root, { backgroundColor: GROUND }]}>
      <Animated.View
        style={{
          alignItems: "center",
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        }}
      >
        {/*
          The same cart the launcher icon carries.
          Tapping an icon and seeing an unrelated page is a small seam, and it
          is the first one anybody meets. A white ring holds it, so the mark
          reads as a mark rather than as a glyph floating on the ground.
        */}
        <View style={styles.markRing}>
          <CartIcon size={40} color={ON_GROUND} />
        </View>
        <Text style={[typography.display, styles.word, { color: ON_GROUND }]}>
          {BRAND.name}
        </Text>
        <Text style={[typography.small, styles.tag, { color: SOFT }]}>
          Shops near you, delivered
        </Text>
      </Animated.View>

      <View style={[styles.dots, { marginTop: spacing.xl }]}>
        {[0, 1, 2].map((index) => (
          <Animated.View
            key={index}
            style={[styles.dot, { backgroundColor: ON_GROUND, opacity: dot(index) }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  /**
   * A ring, not a filled plate.
   *
   * A white circle on brand orange is a bright hole at the centre of the
   * screen and the eye goes to it rather than to the name. An outline holds
   * the mark at the same size while leaving the ground continuous — and
   * `borderRadius` is a real number, because `radius.full` (9999) renders
   * SQUARE on small views under Fabric.
   */
  markRing: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.42)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  word: { fontSize: 38, letterSpacing: -0.8, textAlign: "center" },
  tag: { textAlign: "center", marginTop: 6, letterSpacing: 0.2 },
  dots: { flexDirection: "row", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
