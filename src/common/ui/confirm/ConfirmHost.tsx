import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
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
 */
export function ConfirmHost() {
  const { colors: c, radius, spacing, typography, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const request = useConfirmStore((s) => s.request);
  const answer = useConfirmStore((s) => s.answer);

  if (!request) return null;

  const danger = request.tone === "danger";

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      // Android's back gesture is an answer too, and the safe one.
      onRequestClose={() => answer(false)}
    >
      <Pressable
        style={styles.scrim}
        accessibilityLabel={request.cancelLabel ?? "Cancel"}
        onPress={() => answer(false)}
      >
        {/*
          The sheet swallows its own taps. Without this, pressing a button
          inside it also hits the scrim behind, which answers "no" a frame
          after the button answered "yes".
        */}
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            shadow.lg,
            {
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(16,10,8,0.55)" },
  sheet: { width: "100%" },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
});
