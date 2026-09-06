import React from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../AppButton";
import { useTheme } from "../../../theme";
import { useConfirmStore } from "./confirmStore";

/**
 * Where a confirmation is drawn.
 *
 * A sheet from the bottom, in the app's own type and colour, with the two
 * answers as full-width buttons under each other — the destructive one named
 * for what it does ("Start new", "Empty") rather than "OK", and the safe one
 * last, where a thumb rests.
 *
 * Mounted once at the app root, above the navigator, so it covers whatever is
 * on screen — including another modal, which is exactly where the
 * start-a-new-basket question gets asked from.
 *
 * ── It animates itself, like every other overlay ─────────────────────
 *
 * It used to be `animationType="slide"` — the platform's own, which stops
 * linearly rather than settling and fades no backdrop. Every other overlay in
 * this app (the sheets, the side menu, the toast, the mode cover) is one
 * `Animated` value on the native driver, and this is the one somebody sees at
 * the moment they are being asked to destroy something. A dialog that arrives
 * differently from the rest of the app is a dialog that reads as a system
 * alert rather than as part of the app asking.
 */
/**
 * Declared once, at module scope.
 *
 * `createAnimatedComponent` inside the body returns a new component TYPE every
 * render, and React unmounts and remounts the subtree under it — which for a
 * dialog means the entrance restarting on every state change inside it.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function ConfirmHost() {
  const { colors: c, radius, spacing, typography, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const request = useConfirmStore((s) => s.request);
  const answer = useConfirmStore((s) => s.answer);

  /**
   * The entrance, driven natively.
   *
   * One value: the scrim's opacity is it, and the panel's rise is the same
   * value interpolated — so the dark never arrives before the sheet it is
   * darkening for, which is what a separate timing would eventually do.
   */
  const enter = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!request) {
      enter.setValue(0);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: 220,
      // Out-cubic: quick away from the edge, settling at the end. An ease-in
      // makes a dialog look like it hesitated before asking.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [request, enter]);

  if (!request) return null;

  const danger = request.tone === "danger";

  return (
    <Modal
      visible
      transparent
      // NONE: the animation is the one above. Leaving the platform's slide on
      // would run two entrances at once, at two different speeds.
      animationType="none"
      // Android's back gesture is an answer too, and the safe one.
      onRequestClose={() => answer(false)}
    >
      <AnimatedPressable
        style={[styles.scrim, { opacity: enter }]}
        accessibilityLabel={request.cancelLabel ?? "Cancel"}
        onPress={() => answer(false)}
      >
        {/*
          The sheet swallows its own taps. Without this, pressing a button
          inside it also hits the scrim behind, which answers "no" a frame
          after the button answered "yes".
        */}
        <AnimatedPressable
          onPress={() => {}}
          style={[
            styles.sheet,
            shadow.lg,
            {
              transform: [
                {
                  // Twenty-four points, not the height of the panel: this is a
                  // dialog answering a question, not a sheet being opened, and
                  // a full-height slide reads as a page arriving.
                  translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
                },
              ],
              backgroundColor: c.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              padding: spacing.lg,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
              gap: spacing.sm,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: c.border }]} />

          <Text style={[typography.title, { color: c.text, fontSize: 20 }]}>{request.title}</Text>
          {!!request.message && (
            <Text style={[typography.body, { color: c.textSecondary }]}>{request.message}</Text>
          )}

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <AppButton
              title={request.confirmLabel}
              variant={danger ? "danger" : "primary"}
              size="lg"
              onPress={() => answer(true)}
            />
            <AppButton
              title={request.cancelLabel ?? "Cancel"}
              variant="ghost"
              size="lg"
              onPress={() => answer(false)}
            />
          </View>
        </AnimatedPressable>
      </AnimatedPressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(16,10,8,0.55)" },
  sheet: { width: "100%" },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
});
