import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, StatusBar, StyleSheet, Text, View } from "react-native";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { BRAND } from "../../../common/brand";
import { MARK_H, MARK_W, MarkPieceSvg, type MarkPiece } from "../../../common/components/BrandMark";

/** How long the logo takes to come together; the app waits at least this long once. */
export const INTRO_MS = 1500;

const SIZE = 132;

/**
 * THE SPLASH — WHITE, AND THE LOGO PUTS ITSELF TOGETHER.
 *
 * "Splash screen achi ni, usko white k acha bnao with good animation of logo"
 * and "logo ko pieces main divide krk sath jod skty?". The three pieces of
 * the mark (`BrandMark`) arrive from three sides — the short bar from the
 * left, the big bar from above with a small turn, the foot from below — and
 * lock together; the mark settles with one soft beat and a ring, then the
 * name rises under it. It keeps breathing gently while the session is read.
 *
 * Reduce Motion: the finished logo, still. `onDone` fires when the intro has
 * played (at once under Reduce Motion) so the navigator can hold this screen
 * until the logo is whole, even when the Keychain answers in 50 ms.
 */
export function BootScreen({ onDone }: { onDone?: () => void }) {
  const c = useColors();
  const s = styles(c);

  const bar = useRef(new Animated.Value(0)).current;
  const stem = useRef(new Animated.Value(0)).current;
  const foot = useRef(new Animated.Value(0)).current;
  const beat = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const name = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    const snap = { toValue: 1, useNativeDriver: true } as const;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!alive) return;
        if (reduce) {
          [bar, stem, foot, beat, ring, name].forEach((v) => v.setValue(1));
          onDone?.();
          return;
        }
        Animated.sequence([
          Animated.stagger(140, [
            Animated.spring(bar, { ...snap, friction: 7, tension: 60 }),
            Animated.spring(stem, { ...snap, friction: 7, tension: 55 }),
            Animated.spring(foot, { ...snap, friction: 7, tension: 60 }),
          ]),
          Animated.parallel([
            Animated.timing(beat, { ...snap, duration: 260, easing: Easing.out(Easing.quad) }),
            Animated.timing(ring, { ...snap, duration: 700, easing: Easing.out(Easing.cubic) }),
            Animated.timing(name, { ...snap, duration: 420, delay: 80, easing: Easing.out(Easing.cubic) }),
          ]),
        ]).start(() => {
          if (!alive) return;
          onDone?.();
          Animated.loop(
            Animated.sequence([
              Animated.timing(breathe, { ...snap, duration: 900, easing: Easing.inOut(Easing.sin) }),
              Animated.timing(breathe, { toValue: 0, useNativeDriver: true, duration: 900, easing: Easing.inOut(Easing.sin) }),
            ]),
          ).start();
        });
      });
    return () => {
      alive = false;
    };
  }, [bar, stem, foot, beat, ring, name, breathe, onDone]);

  /** Where each piece starts, and how it travels home. */
  const piece = (p: MarkPiece, v: Animated.Value) => {
    const from = { bar: { x: -150, y: 0, r: "0deg" }, stem: { x: 30, y: -170, r: "-14deg" }, foot: { x: 0, y: 160, r: "0deg" } }[p];
    return {
      opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
      transform: [
        { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [from.x, 0] }) },
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from.y, 0] }) },
        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: [from.r, "0deg"] }) },
      ],
    };
  };

  const markScale = Animated.add(
    beat.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.08, 1] }),
    breathe.interpolate({ inputRange: [0, 1], outputRange: [0, 0.025] }),
  );

  return (
    <View style={s.root} accessibilityLabel={BRAND.name}>
      <StatusBar barStyle="dark-content" backgroundColor={c.surface} />
      <View style={s.stage}>
        <Animated.View
          pointerEvents="none"
          style={[
            s.ring,
            {
              opacity: ring.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.35, 0] }),
              transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] }) }],
            },
          ]}
        />
        <Animated.View style={[s.mark, { transform: [{ scale: markScale }] }]}>
          {(["bar", "stem", "foot"] as const).map((p) => (
            <Animated.View key={p} style={[StyleSheet.absoluteFill, piece(p, { bar, stem, foot }[p])]}>
              <MarkPieceSvg piece={p} size={SIZE} barColor={c.primary} />
            </Animated.View>
          ))}
        </Animated.View>
      </View>

      <Animated.View
        style={{
          opacity: name,
          transform: [{ translateY: name.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
          alignItems: "center",
        }}
      >
        {/* logotype — see SignInScreen. */}
        <Text style={s.wordmark}>{BRAND.family}</Text>
        <Text style={s.sub}>Partner</Text>
      </Animated.View>
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surface, gap: spacing.lg },
    stage: { width: SIZE * 1.8, height: SIZE * 1.8, alignItems: "center", justifyContent: "center" },
    mark: { width: SIZE, height: (SIZE * MARK_H) / MARK_W },
    ring: {
      position: "absolute",
      width: SIZE * 1.3,
      height: SIZE * 1.3,
      borderRadius: SIZE * 0.6,
      borderWidth: 3,
      borderColor: "#2EC0BF",
    },
    // logotype — see SignInScreen.
    wordmark: { ...typography.display, fontSize: 34, color: c.primary, letterSpacing: -0.6 },
    sub: {
      ...typography.label,
      fontSize: 14,
      color: c.textSecondary,
      letterSpacing: 4,
      textTransform: "uppercase",
      marginTop: spacing.xs,
    },
  });
