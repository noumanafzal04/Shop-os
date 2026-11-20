import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@cartze/core/ui/BottomSheet";
import { AppButton } from "@cartze/core/ui/AppButton";
import { toast } from "@cartze/core/ui/toast";
import { ClockIcon, StorefrontIcon } from "@cartze/core/ui/icons";
import { radius, spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useAuthStore } from "../../../stores/authStore";
import { holds } from "../../../common/permissions";
import { useOrdersPause, usePauseOrders, useResumeOrders } from "../hooks/useShop";
import { activePause, backAt, minutesLeft, PAUSE_CHOICES } from "../pause";

/**
 * TAKING ORDERS — OR BUSY, AND UNTIL WHEN.
 *
 * The first thing on the home tab, because it is the one switch a shop reaches
 * for in a hurry: the gas ran out, the power went, the kitchen is drowning.
 * "Pause" asks for how long (15 min to the rest of today) and the shop opens
 * again by itself; "Resume now" ends it early. Only for whoever runs orders.
 */
export function BusyCard() {
  const c = useColors();
  const s = styles(c);
  const user = useAuthStore((st) => st.user);
  const pause = useOrdersPause();
  const doPause = usePauseOrders();
  const doResume = useResumeOrders();
  const [choosing, setChoosing] = useState(false);

  if (!holds(user, "orders.manage")) return null;

  const until = activePause(pause.data);
  const busy = until !== null;

  const choose = (key: string) => {
    const choice = PAUSE_CHOICES.find((p) => p.key === key);
    if (!choice) return;
    doPause.mutate(choice.body, {
      onSuccess: () => {
        setChoosing(false);
        toast.success(`Orders paused — ${choice.label.toLowerCase()}`);
      },
      onError: () => toast.error("Couldn't pause orders. Check the connection and try again."),
    });
  };

  return (
    <>
      <View style={[s.card, busy ? s.cardBusy : s.cardOpen]} accessibilityRole="summary">
        <View style={[s.icon, { backgroundColor: busy ? c.warningBg : c.successBg }]}>
          {busy ? <ClockIcon size={20} color={c.warning} /> : <StorefrontIcon size={20} color={c.success} />}
        </View>
        <View style={s.copy}>
          <Text style={s.title}>{busy ? "Busy — not taking orders" : "Taking orders"}</Text>
          <Text style={s.sub}>
            {busy
              ? `${minutesLeft(until)} min left · ${backAt(until)}`
              : "Customers can order from your shop now"}
          </Text>
        </View>
        {busy ? (
          <Pressable
            style={({ pressed }) => [s.btn, s.btnResume, pressed && s.pressed]}
            onPress={() =>
              doResume.mutate(undefined, {
                onSuccess: () => toast.success("Taking orders again"),
                onError: () => toast.error("Couldn't resume. Try again."),
              })
            }
            disabled={doResume.isPending}
            accessibilityRole="button"
            accessibilityLabel="Resume taking orders now"
          >
            <Text style={s.btnResumeText}>{doResume.isPending ? "…" : "Resume"}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [s.btn, s.btnPause, pressed && s.pressed]}
            onPress={() => setChoosing(true)}
            accessibilityRole="button"
            accessibilityLabel="Pause orders for a while"
          >
            <Text style={s.btnPauseText}>Pause</Text>
          </Pressable>
        )}
      </View>

      <BottomSheet visible={choosing} onClose={() => setChoosing(false)} title="Pause orders for…">
        <View style={s.sheet}>
          <Text style={s.sheetNote}>
            Your shop shows as closed until then, and opens again by itself. Orders already in stay in your queue.
          </Text>
          {PAUSE_CHOICES.map((p) => (
            <AppButton
              key={p.key}
              title={p.label}
              variant="outline"
              onPress={() => choose(p.key)}
              disabled={doPause.isPending}
            />
          ))}
        </View>
      </BottomSheet>
    </>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1.5,
      backgroundColor: c.surface,
    },
    cardOpen: { borderColor: c.border },
    cardBusy: { borderColor: c.warning },
    icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    copy: { flex: 1, gap: 2 },
    title: { ...typography.label, color: c.text, fontSize: 16, lineHeight: 22 },
    sub: { ...typography.small, color: c.textSecondary },
    btn: { height: 38, paddingHorizontal: spacing.md, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    btnPause: { backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
    btnPauseText: { ...typography.label, color: c.text },
    btnResume: { backgroundColor: c.primary },
    btnResumeText: { ...typography.label, color: c.onPrimary },
    pressed: { opacity: 0.8 },
    sheet: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
    sheetNote: { ...typography.small, color: c.textSecondary, marginBottom: spacing.xs },
  });
