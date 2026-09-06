import React from "react";
import {
  Animated,
  StyleSheet,
  Text,
  View,
  type ImageResizeMode,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { type ThemeColors, typography, useColors } from "../../theme";

/**
 * A PICTURE THAT ARRIVES WITHOUT A BANG.
 *
 * ── The three things a raw `<Image>` gets wrong here ─────────────────
 *
 * 1. It pops. A photograph on a slow connection appears fully formed a second
 *    after the card around it, and the eye reads that as a jolt rather than as
 *    loading. Two hundred milliseconds of fade turns the same event into the
 *    image settling in.
 *
 * 2. It leaves a hole. Until the bytes arrive there is a rectangle of nothing,
 *    and a grid of them looks broken rather than pending. A tinted ground with
 *    the shop's own initial in it looks deliberate at every stage — and it is
 *    the SAME initial the app already draws where there is no image at all, so
 *    a shop looks like itself whether its photo has loaded, failed, or was
 *    never uploaded.
 *
 * 3. It has no answer for a broken URL. `onError` is not optional on a
 *    marketplace: a deleted file, an expired link, a shop that typed one in.
 *    Without it the hole is permanent.
 *
 * Everything animated here is `opacity`, which is one of the two properties
 * this app can drive off the JS thread — a fade that stutters while a list
 * scrolls would be worse than no fade.
 */

interface Props {
  uri?: string | null;
  /** Drawn while loading, and left showing if the image never arrives. */
  fallback?: string;
  /** The ground behind the fallback. Usually the shop's derived cover colour. */
  fallbackBackground?: string;
  fallbackColor?: string;
  style?: StyleProp<ViewStyle>;
  resizeMode?: ImageResizeMode;
  accessibilityLabel?: string;
}

export function SmartImage({
  uri,
  fallback,
  fallbackBackground,
  fallbackColor,
  style,
  resizeMode = "cover",
  accessibilityLabel,
}: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const fade = React.useRef(new Animated.Value(0)).current;
  const [failed, setFailed] = React.useState(false);

  // A changed URL is a different picture: fade the new one in rather than
  // cross-cutting to it at whatever opacity the last one reached.
  React.useEffect(() => {
    fade.setValue(0);
    setFailed(false);
  }, [uri, fade]);

  const show = () => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View
      style={[styles.wrap, fallbackBackground != null && { backgroundColor: fallbackBackground }, style]}
      accessibilityLabel={accessibilityLabel}
    >
      {/*
        The fallback is BEHIND, always drawn, never removed. Unmounting it the
        moment the image loads is what causes the one-frame flash of the page
        colour between the two — and if the image later fails to decode there
        is nothing left underneath.
      */}
      {!!fallback && (
        <Text style={[styles.initial, fallbackColor != null && { color: fallbackColor }]}>
          {fallback}
        </Text>
      )}

      {!!uri && !failed && (
        <Animated.Image
          source={{ uri }}
          // Written out rather than `StyleSheet.absoluteFill`, which is a
          // registered style ID — spreading or composing it into an array
          // alongside an animated value contributes nothing, which is how a
          // previous overlay in this app ended up with no size at all.
          style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, { opacity: fade }]}
          resizeMode={resizeMode}
          onLoad={show}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    initial: { ...typography.display, fontSize: 26, color: c.gray[300] },
  });
