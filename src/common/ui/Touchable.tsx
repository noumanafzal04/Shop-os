import React from "react";
import {
  Animated,
  Platform,
  Pressable,
  Vibration,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/**
 * A THING THAT ANSWERS WHEN YOU TOUCH IT.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 *
 * The app had a hundred and seventeen `Pressable`s and seventeen of them
 * reacted to being pressed. The other hundred — every shop row, every product
 * tile, every order in the list — did nothing at all under a finger. Tap, and
 * the screen changes a moment later or it does not, and there is no way to
 * tell which until it happens.
 *
 * That gap is most of what separates an app that feels made from an app that
 * feels like a web page in a frame. Nothing is slow about the old behaviour;
 * it is silent, which reads as slow.
 *
 * ── Why a scale and not just an opacity ──────────────────────────────
 *
 * Opacity alone reads as "this is disabled" on a light card. A press is a
 * physical idea — the thing gives under the finger — and two or three per cent
 * of scale carries that at a size nobody consciously notices. The spring back
 * is deliberately faster than the press down: pressing should feel damped,
 * releasing should feel immediate.
 *
 * ── The native driver, and what that costs ───────────────────────────
 *
 * `transform` and `opacity` are the only two properties this app can animate
 * off the JS thread, and both are used here for exactly that reason. A press
 * animation that stutters while a list is rendering is worse than none.
 */

interface Props extends Omit<PressableProps, "style"> {
  children: React.ReactNode;
  /**
   * `StyleProp`, not `ViewStyle[]`.
   *
   * Conditional styles — `[styles.card, closed && styles.dim]` — put `false`
   * in the array, which every React Native style prop accepts and a narrower
   * type rejects. Typing it tighter than the platform does only means every
   * call site casting around it.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * How far it gives. The default is right for a card or a row; a small icon
   * button wants more, because two per cent of forty points is invisible.
   */
  scaleTo?: number;
  /**
   * A short tick on press.
   *
   * Off by default and worth switching on for the handful of actions that
   * COMMIT something — adding to a basket, accepting a job. A phone that
   * buzzes for every tap is a phone people turn the buzzing off on, and then
   * it is not there for the taps that mattered.
   */
  haptic?: boolean;
}

export function Touchable({
  children,
  style,
  scaleTo = 0.97,
  haptic = false,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: Props) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const dim = React.useRef(new Animated.Value(1)).current;

  const press = React.useCallback(
    (to: number, opacity: number, fast: boolean) => {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: to,
          // Down is damped, up is immediate — a press should feel absorbed and
          // a release should feel like letting go.
          damping: fast ? 14 : 22,
          stiffness: fast ? 420 : 300,
          mass: 0.55,
          useNativeDriver: true,
        }),
        Animated.timing(dim, {
          toValue: opacity,
          duration: fast ? 120 : 70,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [dim, scale],
  );

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        if (!disabled) {
          press(scaleTo, 0.9, false);
          // 12ms is a tick, not a buzz. iOS ignores a duration this short and
          // gives its own default, which is what we want there anyway.
          if (haptic) Vibration.vibrate(Platform.OS === "android" ? 12 : 10);
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press(1, 1, true);
        onPressOut?.(e);
      }}
    >
      {/*
        The animation lives on an inner view, not on the Pressable itself.
        `Animated.createAnimatedComponent(Pressable)` works, but scaling the
        element that owns the touch target moves the target with it — and a
        row that shrinks under a finger then reports the finger as having
        slid off it.
      */}
      <Animated.View style={[style, { opacity: dim, transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
