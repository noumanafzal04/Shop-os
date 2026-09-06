import React from "react";
import { Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

/**
 * CONTENT THAT ARRIVES, rather than content that is suddenly there.
 *
 * ── What this is for ─────────────────────────────────────────────────
 *
 * A list that pops into existence fully formed reads as a page load. The same
 * list sliding up eight points over two hundred milliseconds, each row a beat
 * behind the one above, reads as the app assembling itself — and the second one
 * is what people mean when they call an app smooth.
 *
 * It is not decoration and it is not slow: nothing waits for it. The rows are
 * on screen the whole time; what moves is where they start from.
 *
 * ── Why the stagger is capped ────────────────────────────────────────
 *
 * `index * 40ms` is lovely for six rows and absurd for sixty — the last one
 * would arrive two and a half seconds after the first, which is not a flourish
 * any more, it is a wait. So the delay stops climbing after a handful, and
 * anything further down simply appears with the group.
 *
 * ── And why it never animates twice ──────────────────────────────────
 *
 * A `FlatList` recycles rows. Without the ref below, scrolling back up would
 * replay the entrance on rows that have been on screen for a minute — which is
 * the single most common way this effect goes from pleasant to broken.
 */

interface Props {
  children: React.ReactNode;
  /** Position in a list. Drives the stagger; omit for a one-off. */
  index?: number;
  /** How far it travels. Small on purpose — this is a hint, not a slide. */
  distance?: number;
  style?: StyleProp<ViewStyle>;
}

/** After this many rows the stagger stops growing. */
const MAX_STAGGERED = 8;
const STEP_MS = 45;

export function Appear({ children, index = 0, distance = 10, style }: Props) {
  const progress = React.useRef(new Animated.Value(0)).current;
  const played = React.useRef(false);

  React.useEffect(() => {
    if (played.current) return;
    played.current = true;

    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      delay: Math.min(index, MAX_STAGGERED) * STEP_MS,
      // Out-cubic: quick to start, settling at the end. An ease-in would make
      // every row feel like it hesitated before appearing.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [index, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
