import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { AppButton } from "@cartze/core/ui/AppButton";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { toast } from "@cartze/core/ui/toast";
import { ApiError } from "@cartze/core/types/api";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useSaveHours, useShop } from "../hooks/useShop";
import type { BusinessHour } from "../services/shopService";

/**
 * WHEN THE SHOP IS OPEN — and the app's ONLY answer to "are you open".
 *
 * ── Day 0 is Sunday ──────────────────────────────────────────────────
 *
 * Because the server compares against Carbon's `dayOfWeek`, where 0 is Sunday.
 * Labelling this list from Monday and storing the index would shift every
 * shop's week by one day, which looks correct for six days a week.
 *
 * ── Empty hours means ALWAYS OPEN, not never ─────────────────────────
 *
 * `isOpenNow()` returns true when nothing is saved — a shop that has not
 * configured hours is never blocked. But the moment ONE day is saved, a day
 * with no times is CLOSED. So saving a single day quietly shuts the other six,
 * and that is said on the screen rather than discovered on a Sunday.
 *
 * ── A close before its open wraps past midnight ──────────────────────
 *
 * 18:00–02:00 is a real dhaba's hours and the server handles it. Nothing here
 * should "correct" it.
 */
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function HoursScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();

  const { data: shop, isLoading, isError, refetch } = useShop();
  const save = useSaveHours();

  const [hours, setHours] = useState<BusinessHour[] | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!shop || touched) return;
    const saved = shop.business_hours ?? [];
    setHours(
      DAYS.map((_, day) => {
        const found = saved.find((h) => h.day === day);
        return { day, open: found?.open ?? null, close: found?.close ?? null };
      }),
    );
  }, [shop, touched]);

  function set(day: number, patch: Partial<BusinessHour>) {
    setTouched(true);
    setHours((h) => (h ?? []).map((row) => (row.day === day ? { ...row, ...patch } : row)));
  }

  async function submit() {
    if (!hours) return;

    const bad = hours.find(
      (h) => (h.open && !isTime(h.open)) || (h.close && !isTime(h.close)),
    );
    if (bad) {
      // The server takes `H:i` and refuses anything else. Saying so here names
      // the shape instead of echoing a validation message about a field index.
      toast.error(`${DAYS[bad.day]}: use a 24-hour time like 09:00`);
      return;
    }

    try {
      // A day that is shut is sent with nulls rather than left out — the
      // server reads a missing day and a day with no times the same way, and
      // sending all seven makes what was saved readable.
      await save.mutateAsync(hours);
      setTouched(false);
      toast.success("Hours saved");
      nav.goBack();
    } catch (e) {
      toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "Could not save");
    }
  }

  const anySaved = (hours ?? []).some((h) => h.open && h.close);

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader title="Opening hours" onBack={() => nav.goBack()} />

      {isLoading && !hours ? (
        <View style={s.body}>
          <Skeleton height={320} borderRadius={16} />
        </View>
      ) : isError && !shop ? (
        <View style={s.body}>
          <LoadFailed
            what="your hours"
            onRetry={() => {
              void refetch();
            }}
          />
        </View>
      ) : hours ? (
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.note}>
            {anySaved
              ? "A day with no times is closed all day."
              : "No hours set — customers can order at any time. Set even one day and the rest count as closed."}
          </Text>

          {hours.map((h) => {
            const open = h.open !== null || h.close !== null;
            return (
              <View key={h.day} style={s.card}>
                <View style={s.dayRow}>
                  <Text style={s.day}>{DAYS[h.day]}</Text>
                  <Switch
                    value={open}
                    onValueChange={(on) =>
                      set(h.day, on ? { open: "09:00", close: "22:00" } : { open: null, close: null })
                    }
                    trackColor={{ true: c.primary, false: c.border }}
                    thumbColor={c.surface}
                  />
                </View>

                {open ? (
                  <View style={s.times}>
                    <View style={s.time}>
                      <AppTextInput
                        label="Opens"
                        value={h.open ?? ""}
                        onChangeText={(t) => set(h.day, { open: t })}
                        placeholder="09:00"
                        keyboardType="numbers-and-punctuation"
                      />
                    </View>
                    <View style={s.time}>
                      <AppTextInput
                        label="Closes"
                        value={h.close ?? ""}
                        onChangeText={(t) => set(h.day, { close: t })}
                        placeholder="22:00"
                        keyboardType="numbers-and-punctuation"
                      />
                    </View>
                  </View>
                ) : (
                  <Text style={s.closed}>Closed</Text>
                )}
              </View>
            );
          })}

          <AppButton
            title="Save hours"
            onPress={submit}
            disabled={!touched}
            loading={save.isPending}
            size="lg"
          />
        </ScrollView>
      ) : null}
    </SafeScreen>
  );
}

/** `H:i` — what the server's `date_format` rule accepts, and nothing else. */
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xxl },
    note: { ...typography.small, color: c.textSecondary, lineHeight: 19, marginBottom: spacing.xs },
    card: {
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.sm,
    },
    dayRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    day: { ...typography.body, fontSize: 16, color: c.text },
    times: { flexDirection: "row", gap: spacing.sm },
    time: { flex: 1 },
    closed: { ...typography.small, color: c.textMuted },
  });
