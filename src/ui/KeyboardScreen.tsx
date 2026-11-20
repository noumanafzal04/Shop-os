import React from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  type ViewStyle,
} from "react-native";

/**
 * "LOGIN MAIN JB EMAIL YA PASSWORD PY CLICK KRTY TO WO KEYBOARD K BACK MAIN
 * ATA HAI" — Android was left to `adjustResize` (behavior undefined). The app
 * targets SDK 36, and from Android 15 every app is drawn edge to edge, where
 * `adjustResize` no longer shrinks the window: the keyboard simply covered the
 * form. `padding` measures the keyboard's overlap with THIS view, so on an
 * older phone that still resizes the overlap is 0 and nothing doubles.
 */
export const KEYBOARD_BEHAVIOR = "padding" as const;

interface Props {
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  /** The scroll itself, for a "See summary" that jumps down to the bill. */
  scrollRef?: React.Ref<ScrollView>;
  /**
   * A bar pinned under the scroll — an action the person should be able to
   * reach without scrolling to find it.
   *
   * It sits INSIDE the KeyboardAvoidingView on purpose. Pinned outside, iOS
   * lifts the scroll and leaves the bar under the keyboard, which is the exact
   * failure this component exists to prevent: on the checkout screen, being
   * unable to reach the button costs the order.
   */
  footer?: React.ReactNode;
}

/**
 * Keyboard-aware scrolling for any form screen:
 *  - inputs are never covered by the keyboard (padding, on BOTH platforms)
 *  - tapping outside an input dismisses the keyboard
 *  - taps on buttons work while the keyboard is open (persistTaps)
 *  - an optional pinned `footer` that rides above the keyboard too
 */
export function KeyboardScreen({ children, contentStyle, footer, scrollRef }: Props) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={KEYBOARD_BEHAVIOR}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </TouchableWithoutFeedback>
      {footer != null && <View>{footer}</View>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1 },
});
