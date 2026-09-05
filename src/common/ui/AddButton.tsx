import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, type ViewStyle } from "react-native";
import { Check, Plus } from "lucide-react-native";
import { radius, type ThemeColors, useColors } from "../../theme";

/**
 * The circle that puts one thing in the basket.
 *
 * ── Why it needed rebuilding ─────────────────────────────────────────
 *
 * It was the character `＋` in a red disc with no pressed state at all. Two
 * problems, and the second is the one people notice:
 *
 *  1. A fullwidth plus is TYPE. It takes the font's weight, its optical size
 *     and its own idea of where the centre is, so it sat a pixel high and
 *     read thinner than every drawn icon beside it. Same fault as the `→` on
 *     the cart bar.
 *
 *  2. Nothing happened when you pressed it. The line was added, the bar at the
 *     bottom of the screen changed — 700px away from the thumb, outside the
 *     area anybody is looking at. So the honest read of that screen was that
 *     the button did nothing, and the next thing a person does is press it
 *     again.
 *
 * ── What it does now ─────────────────────────────────────────────────
 *
 * Presses down under the finger, springs back, and turns into a TICK for just
 * under a second. The tick is the part that answers "did that work" without
 * making anybody look somewhere else; the spring is what makes it feel
 * pressed rather than merely re-coloured.
 *
 * Both are transform-only, so both run on the native driver — a list of forty
 * menu rows is exactly where a JS-driven animation stutters.
 */

/** How long the tick stays before the button offers itself again. */
const CONFIRM_MS = 900;

interface Props {
  onPress: () => void;
  /** What is being added — for the screen reader, which cannot see the row. */
  label: string;
  size?: number;
  style?: ViewStyle;
}

export function AddButton({ onPress, label, size = 34, style }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const scale = useRef(new Animated.Value(1)).current;
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // FlatList recycles these by the dozen; a timer left running writes state
  // into an unmounted row.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const press = () => {
    onPress();
    setAdded(true);
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.84, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, {
        toValue: 1,
        damping: 11,
        stiffness: 340,
        mass: 0.6,
        useNativeDriver: true,
      }),
    ]).start();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), CONFIRM_MS);
  };

  const icon = size >= 30 ? 18 : 15;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={press}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={added ? `${label} added` : `Add ${label}`}
        style={({ pressed }) => [
          styles.btn,
          { width: size, height: size, borderRadius: radius.full },
          added && styles.done,
          pressed && !added && styles.pressed,
        ]}
      >
        {added ? (
          <Check size={icon} color={c.onPrimary} strokeWidth={3} />
        ) : (
          <Plus size={icon} color={c.onPrimary} strokeWidth={2.8} />
        )}
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    btn: { backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
    pressed: { backgroundColor: c.primaryPressed },
    done: { backgroundColor: c.success },
  });
