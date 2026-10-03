import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { AppButton } from "@cartze/core/ui/AppButton";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { toast } from "@cartze/core/ui/toast";
import { ApiError } from "@cartze/core/types/api";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useSaveHours, useShop } from "../hooks/useShop";
import type { BusinessHour } from "../services/shopService";

/**
 * WHEN THE SHOP IS OPEN — and the app's ONLY answer to "are you open".
 *
 * ── Most shops keep the same hours seven days a week ─────────────────
 *
 * So that is the screen's DEFAULT: one pair of times, and a row of days to
 * untick for the one the shop is shut. Typing 09:00 and 22:00 fourteen times
 * is not configuration, it is data entry, and the first version of this screen
 * asked for exactly that.
 *
 * "Different each day" is still there, because a dhaba that closes early on
 * Friday is real. The mode is CHOSEN, not guessed, and what is already saved
 * decides which one opens: hours that already differ open on the day-by-day
 * view rather than being silently flattened.
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
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Mode = "same" | "custom";

export function HoursScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();

  const { data: shop, isLoading, isError, refetch } = useShop();
  const save = useSaveHours();

  const [hours, setHours] = useState<BusinessHour[] | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [sameOpen, setSameOpen] = useState("09:00");
  const [sameClose, setSameClose] = useState("22:00");
  const [openDays, setOpenDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!shop || touched) return;
    const saved = shop.business_hours ?? [];
    const rows = DAYS.map((_, day) => {
      const found = saved.find((h) => h.day === day);
      return { day, open: found?.open ?? null, close: found?.close ?? null };
    });
    setHours(rows);

    /**
     * WHICH VIEW OPENS IS READ OFF WHAT IS SAVED.
     *
     * A shop whose days already differ must not land on the simple view — it
     * would show one pair of times that is true for some days and wrong for
     * others, and the first save would flatten a week somebody set up
     * deliberately.
     */
    const on = rows.filter((r) => r.open && r.close);
    const uniform =
      on.length === 0 || on.every((r) => r.open === on[0].open && r.close === on[0].close);

    setMode(uniform ? "same" : "custom");
    if (on.length > 0) {
      setSameOpen(on[0].open ?? "09:00");
      setSameClose(on[0].close ?? "22:00");
      setOpenDays(on.map((r) => r.day));
    }
  }, [shop, touched]);

  function set(day: number, patch: Partial<BusinessHour>) {
    setTouched(true);
    setHours((h) => (h ?? []).map((row) => (row.day === day ? { ...row, ...patch } : row)));
  }

  const toggleDay = (day: number) => {
    setTouched(true);
    setOpenDays((on) => (on.includes(day) ? on.filter((d) => d !== day) : [...on, day].sort()));
  };

  /**
   * SWITCHING TO SIMPLE CARRIES THE DAYS ACROSS, it does not reset them.
   *
   * Somebody who set six days by hand and then decides they are all the same
   * should find those six days still ticked and the first day's times in the
   * boxes — not seven ticked days and 09:00, which is the app throwing away
   * what they just typed.
   */
  function switchTo(next: Mode) {
    setTouched(true);
    if (next === "same" && hours) {
      const on = hours.filter((h) => h.open && h.close);
      if (on.length > 0) {
        setSameOpen(on[0].open ?? sameOpen);
        setSameClose(on[0].close ?? sameClose);
        setOpenDays(on.map((h) => h.day));
      }
    }
    if (next === "custom") {
      // The simple view's answer becomes the starting point for the detailed
      // one, so "mostly the same, except Friday" is two taps rather than seven.
      setHours(
        DAYS.map((_, day) =>
          openDays.includes(day)
            ? { day, open: sameOpen, close: sameClose }
            : { day, open: null, close: null },
        ),
      );
    }
    setMode(next);
  }

  /** What would be sent, given the mode currently on screen. */
  const payload = useMemo<BusinessHour[]>(() => {
    if (mode === "same") {
      return DAYS.map((_, day) =>
        openDays.includes(day)
          ? { day, open: sameOpen.trim(), close: sameClose.trim() }
          : { day, open: null, close: null },
      );
    }
    return hours ?? [];
  }, [mode, openDays, sameOpen, sameClose, hours]);

  async function submit() {
    const bad = payload.find((h) => (h.open && !isTime(h.open)) || (h.close && !isTime(h.close)));
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
      await save.mutateAsync(payload);
      setTouched(false);
      toast.success("Hours saved");
      nav.goBack();
    } catch (e) {
      toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "Could not save");
    }
  }

  const anyOpen = payload.some((h) => h.open && h.close);

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
      ) : hours && mode ? (
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <View style={s.modes}>
            <Mode2 label="Same every day" on={mode === "same"} onPress={() => switchTo("same")} />
            <Mode2
              label="Different each day"
              on={mode === "custom"}
              onPress={() => switchTo("custom")}
            />
          </View>

          <Text style={s.note}>
            {anyOpen
              ? "A day that is off is closed all day."
              : "No hours set — customers can order at any time. Set even one day and the rest count as closed."}
          </Text>

          {mode === "same" ? (
            <View style={s.card}>
              <View style={s.times}>
                <View style={s.time}>
                  <AppTextInput
                    label="Opens"
                    value={sameOpen}
                    onChangeText={(t) => {
                      setTouched(true);
                      setSameOpen(t);
                    }}
                    placeholder="09:00"
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={s.time}>
                  <AppTextInput
                    label="Closes"
                    value={sameClose}
                    onChangeText={(t) => {
                      setTouched(true);
                      setSameClose(t);
                    }}
                    placeholder="22:00"
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>

              <Text style={s.label}>Open on</Text>
              <View style={s.dayChips}>
                {SHORT.map((label, day) => {
                  const on = openDays.includes(day);
                  return (
                    <Touchable
                      key={label}
                      onPress={() => toggleDay(day)}
                      accessibilityRole="button"
                      accessibilityLabel={DAYS[day]}
                      accessibilityState={{ selected: on }}
                      style={[s.dayChip, on ? s.dayChipOn : null]}
                    >
                      <Text style={[s.dayChipText, on ? s.dayChipTextOn : null]}>{label}</Text>
                    </Touchable>
                  );
                })}
              </View>

              {openDays.length === 0 ? (
                <Text style={s.warn}>Every day is off — your shop would never be open.</Text>
              ) : null}
            </View>
          ) : (
            hours.map((h) => {
              const open = h.open !== null || h.close !== null;
              return (
                <View key={h.day} style={s.card}>
                  <View style={s.dayRow}>
                    <Text style={s.day}>{DAYS[h.day]}</Text>
                    <Switch
                      value={open}
                      onValueChange={(on) =>
                        set(
                          h.day,
                          on
                            ? { open: sameOpen, close: sameClose }
                            : { open: null, close: null },
                        )
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
            })
          )}

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

/** Named `Mode2` because `Mode` is the type above. Two-state segmented pill. */
function Mode2({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const s = styles(useColors());
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[s.mode, on ? s.modeOn : null]}
    >
      <Text style={[s.modeText, on ? s.modeTextOn : null]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

/** `H:i` — what the server's `date_format` rule accepts, and nothing else. */
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xxl },
    modes: { flexDirection: "row", gap: spacing.sm },
    mode: {
      flex: 1,
      alignItems: "center",
      paddingVertical: spacing.sm + 2,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    modeOn: { backgroundColor: c.primary, borderColor: c.primary },
    modeText: { ...typography.label, fontSize: 13, color: c.textSecondary },
    modeTextOn: { color: c.onPrimary },

    note: { ...typography.small, color: c.textSecondary, lineHeight: 19, marginBottom: spacing.xs },
    warn: { ...typography.small, color: c.error },
    label: { ...typography.label, color: c.gray[700] },
    card: {
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.sm,
    },
    dayRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    day: { ...typography.body, fontSize: 16, color: c.text },
    times: { flexDirection: "row", gap: spacing.sm },
    time: { flex: 1 },
    closed: { ...typography.small, color: c.textMuted },

    dayChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    dayChip: {
      minWidth: 52,
      alignItems: "center",
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    dayChipOn: { backgroundColor: c.primary, borderColor: c.primary },
    dayChipText: { ...typography.label, fontSize: 13, color: c.textSecondary },
    dayChipTextOn: { color: c.onPrimary },
  });
