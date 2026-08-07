import React from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  type ViewStyle,
} from "react-native";

interface Props {
  children: React.ReactNode;
  contentStyle?: ViewStyle;
}

/**
 * Keyboard-aware scrolling for any form screen:
 *  - inputs are never covered by the keyboard (iOS padding / Android resize)
 *  - tapping outside an input dismisses the keyboard
 *  - taps on buttons work while the keyboard is open (persistTaps)
 */
export function KeyboardScreen({ children, contentStyle }: Props) {
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1 },
});
