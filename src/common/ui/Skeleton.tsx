import React from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../../theme";

/**
 * Loading placeholders.
 *
 * Two things changed from the first version, and both were bugs rather than
 * taste:
 *
 *   THEME   it read the deprecated static palette, so every skeleton was a
 *           light-grey block — including on a near-black page, where it is a
 *           bright slab that looks like content that failed to load.
 *
 *   MOTION  a full-block pulse fades the LAYOUT in and out, so a list of eight
 *           cards breathes as one object. A sweep moves across a block that
 *           stays put, which reads as "this is coming" instead.
 *
 * Compose these to mirror the real layout, so nothing jumps when the data
 * lands.
 */

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/** One sweep across every skeleton on screen, shared so they move together. */
function useShimmer(): { progress: Animated.Value; still: boolean } {
  const progress = React.useRef(new Animated.Value(0)).current;
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
    if (still) return; // a still block is the whole accommodation

    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1250,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );

    loop.start();
    return () => loop.stop();
  }, [progress, still]);

  return { progress, still };
}

export function Skeleton({ width = "100%", height = 16, borderRadius, style }: SkeletonProps) {
  const { colors: c, radius } = useTheme();
  const { progress, still } = useShimmer();

  const [measured, setMeasured] = React.useState(0);

  return (
    <View
      onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}
      style={[
        // The sweep is a child wider than its parent; clipped, or it paints
        // over the card it is inside.
        styles.clip,
        {
          width,
          height,
          borderRadius: borderRadius ?? radius.sm,
          backgroundColor: c.surfaceAlt,
        },
        style,
      ]}
    >
      {!still && measured > 0 && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: c.border,
              // A soft band rather than a hard edge — a sharp rectangle sliding
              // past reads as a glitch, not a wait.
              opacity: progress.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0, 0.85, 0],
              }),
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-measured, measured],
                  }),
                },
              ],
            },
          ]}
        />
      )}
    </View>
  );
}

/**
 * ── Composed skeletons ────────────────────────────────────────────────
 *
 * Each of these mirrors ONE real component. That is the whole point and it was
 * not what this file did: eight screens shared a single grey rectangle the
 * height of a row, and a single `SkeletonCard` — a bordered card with a
 * picture in it — stood in for the orders and reservations lists, neither of
 * which has a picture anywhere. It has been deleted rather than left unused:
 * the next screen to reach for it would inherit the same lie.
 *
 * A placeholder that is not the shape of what is coming does two things wrong.
 * The page jumps when the data lands, and for the second or two before that it
 * describes something that is not on its way.
 *
 * Text lines are deliberately UNEQUAL — 70%, 45%. Two bars of identical width
 * read as a table; text does not do that, and the eye knows.
 */

/** A shop, as a card on the home row or a row in the shops list. */
export function SkeletonListRow({ width }: { width?: number }) {
  const { colors: c, radius, spacing } = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          width,
          gap: spacing.sm,
          padding: spacing.sm,
          borderRadius: radius.lg,
          borderColor: c.border,
          backgroundColor: c.surface,
        },
      ]}
    >
      {/* the logo tile, at its real 52 */}
      <Skeleton width={52} height={52} borderRadius={radius.md} />
      <View style={styles.rowCopy}>
        <Skeleton width="70%" height={13} />
        <Skeleton width="45%" height={11} style={{ marginTop: 7 }} />
        <Skeleton width="30%" height={10} style={{ marginTop: 7 }} />
      </View>
    </View>
  );
}

/** A line on a shop's menu: thumbnail, name, price, and the add button. */
export function SkeletonMenuRow() {
  const { colors: c, radius, spacing } = useTheme();

  return (
    <View style={[styles.row, { gap: spacing.sm, paddingVertical: spacing.sm }]}>
      <View style={styles.rowCopy}>
        <Skeleton width="65%" height={14} />
        <Skeleton width="85%" height={11} style={{ marginTop: 8 }} />
        <Skeleton width="28%" height={13} style={{ marginTop: 10 }} />
      </View>
      <Skeleton width={84} height={84} borderRadius={radius.md} />
      {/* the round + that sits over the corner of the picture */}
      <View style={[styles.add, { borderColor: c.surface }]}>
        <Skeleton width={30} height={30} borderRadius={radius.full} />
      </View>
    </View>
  );
}

/**
 * A record with a state: a title, a status pill beside it, a couple of lines,
 * and — for the ones that carry money — a totals row under a rule.
 *
 * One component for orders and reservations because they are the same card,
 * and `footer` is the one honest difference between them: an order has a total
 * and a reservation does not.
 */
export function SkeletonStatusCard({ footer = false }: { footer?: boolean }) {
  const { colors: c, radius, spacing } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          padding: spacing.md,
          marginBottom: spacing.sm,
          borderRadius: radius.md,
          borderColor: c.border,
          backgroundColor: c.surface,
        },
      ]}
    >
      <View style={styles.between}>
        <Skeleton width={110} height={14} />
        {/* the status pill — a pill, because that is what lands here */}
        <Skeleton width={72} height={20} borderRadius={radius.full} />
      </View>
      <Skeleton width="40%" height={11} style={{ marginTop: 8 }} />
      <Skeleton width="75%" height={11} style={{ marginTop: 12 }} />

      {footer && (
        <View
          style={[
            styles.between,
            styles.footer,
            { borderTopColor: c.border, marginTop: spacing.md, paddingTop: spacing.sm },
          ]}
        >
          <Skeleton width={90} height={11} />
          <Skeleton width={70} height={14} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  card: { borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  rowCopy: { flex: 1 },
  add: { position: "absolute", right: 8, bottom: 4, borderRadius: 999, borderWidth: 3 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footer: { borderTopWidth: 1 },
});
