import React from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  type ViewStyle,
} from "react-native";

interface Props {
  children: React.ReactNode;
  contentStyle?: ViewStyle;
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
 *  - inputs are never covered by the keyboard (iOS padding / Android resize)
 *  - tapping outside an input dismisses the keyboard
 *  - taps on buttons work while the keyboard is open (persistTaps)
 *  - an optional pinned `footer` that rides above the keyboard too
 */
export function KeyboardScreen({ children, contentStyle, footer }: Props) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
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
