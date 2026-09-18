import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { KeyboardScreen } from "@cartze/core/ui/KeyboardScreen";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { AppButton } from "@cartze/core/ui/AppButton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { toast } from "@cartze/core/ui/toast";
import { ApiError } from "@cartze/core/types/api";
import { ChevronRightIcon, ClockIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useSaveSettings, useShopSettings } from "../hooks/useShop";
import type { ShopSettings } from "../services/shopService";
import type { AccountStackParamList } from "../../../navigation/types";

/**
 * HOW THIS SHOP TAKES ORDERS.
 *
 * The delivery rules a shopkeeper actually changes — and only those. Tax,
 * receipts, POS behaviour and the fifty other keys in `allSettings()` belong
 * to the panel: a settings screen that offers everything on a phone is one
 * nobody reads, and half of it cannot be decided standing up.
 *
 * ── The control that is missing, and is not faked here ───────────────
 *
 * There is no "pause orders" switch, because the SERVER has no such state. A
 * shop is open or shut by its `business_hours` and nothing else, and
 * `updateSettings` explicitly refuses to leave both pickup and delivery off
 * ("Enable at least one fulfillment option").
 *
 * So a shop with a power cut, or one that has run out of gas at 7pm, has no
 * way to stop orders except to edit today's hours — which then has to be
 * edited back. That is a real gap and it belongs on the server; inventing a
 * switch here that quietly rewrites the shop's saved hours would lose the real
 * ones and look like a feature.
 */
export function ShopScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation<NativeStackNavigationProp<AccountStackParamList>>();

  const { data, isLoading, isError, refetch } = useShopSettings();
  const save = useSaveSettings();

  const [form, setForm] = useState<Partial<ShopSettings> | null>(null);
  const [touched, setTouched] = useState(false);

  /** Fills once. See the same fence, and the same reason, on the product form. */
  useEffect(() => {
    if (!data || touched) return;
    setForm({
      pickup_enabled: data.pickup_enabled !== false,
      delivery_enabled: data.delivery_enabled !== false,
      delivery_radius_km: numberOrNull(data.delivery_radius_km),
      min_order_amount: numberOrNull(data.min_order_amount),
      free_delivery_threshold: numberOrNull(data.free_delivery_threshold),
      prep_time_minutes: numberOrNull(data.prep_time_minutes),
    });
  }, [data, touched]);

  function set<K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) {
    setTouched(true);
    setForm((f) => ({ ...(f ?? {}), [key]: value }));
  }

  async function submit() {
    if (!form) return;
    try {
      await save.mutateAsync(form);
      setTouched(false);
      toast.success("Settings saved");
    } catch (e) {
      /**
       * The both-off refusal comes back as `FULFILLMENT_REQUIRED` with a
       * sentence written for a person. Shown as it comes rather than
       * translated — the server's wording already names the fix.
       */
      toast.error(e instanceof ApiError ? e.message : "Could not save settings");
    }
  }

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader title="Shop settings" onBack={() => nav.goBack()} />

      {isLoading && !form ? (
        <View style={s.body}>
          <Skeleton height={140} borderRadius={16} />
          <Skeleton height={200} borderRadius={16} />
        </View>
      ) : isError && !data ? (
        <View style={s.body}>
          <LoadFailed
            what="your settings"
            onRetry={() => {
              void refetch();
            }}
          />
        </View>
      ) : form ? (
        <KeyboardScreen contentStyle={s.body}>
          <Touchable
            onPress={() => nav.navigate("Hours")}
            accessibilityRole="button"
            style={s.rowCard}
          >
            <ClockIcon size={20} color={c.textSecondary} />
            <View style={s.rowBody}>
              <Text style={s.rowLabel}>Opening hours</Text>
              <Text style={s.rowMeta}>When customers can order</Text>
            </View>
            <ChevronRightIcon size={18} color={c.textMuted} />
          </Touchable>

          <View style={s.card}>
            <Toggle
              label="Collection"
              hint="Customers pick up from the shop"
              value={form.pickup_enabled ?? true}
              onChange={(v) => set("pickup_enabled", v)}
            />
            <View style={s.rule} />
            <Toggle
              label="Delivery"
              hint="You or a CartZe rider takes it to them"
              value={form.delivery_enabled ?? true}
              onChange={(v) => set("delivery_enabled", v)}
            />
            <Text style={s.note}>
              At least one has to stay on — a shop nobody can order from is a shop that is shut.
            </Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Delivery rules</Text>

            <AppTextInput
              label="Delivery radius (km)"
              placeholder="Leave empty for city-wide"
              value={text(form.delivery_radius_km)}
              onChangeText={(t) => set("delivery_radius_km", numberOrNull(t))}
              keyboardType="numeric"
            />
            <AppTextInput
              label="Minimum order (Rs)"
              placeholder="No minimum"
              value={text(form.min_order_amount)}
              onChangeText={(t) => set("min_order_amount", numberOrNull(t))}
              keyboardType="numeric"
            />
            <AppTextInput
              label="Free delivery over (Rs)"
              placeholder="Never free"
              value={text(form.free_delivery_threshold)}
              onChangeText={(t) => set("free_delivery_threshold", numberOrNull(t))}
              keyboardType="numeric"
            />
            <AppTextInput
              label="Preparation time (minutes)"
              placeholder="Not shown"
              value={text(form.prep_time_minutes)}
              onChangeText={(t) => set("prep_time_minutes", numberOrNull(t))}
              keyboardType="numeric"
            />

            <Text style={s.note}>
              An empty field means no limit, not zero. A zero minimum order and no minimum order
              are the same thing to a customer, but a zero radius would deliver nowhere.
            </Text>
          </View>

          <AppButton
            title="Save settings"
            onPress={submit}
            disabled={!touched}
            loading={save.isPending}
            size="lg"
          />
        </KeyboardScreen>
      ) : null}
    </SafeScreen>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const c = useColors();
  const s = styles(c);
  return (
    <View style={s.toggle}>
      <View style={s.rowBody}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowMeta}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.primary, false: c.border }}
        thumbColor={c.surface}
      />
    </View>
  );
}

/**
 * "" and "0" are different answers.
 *
 * An empty field means "no limit" and must send null; zero means zero. Parsing
 * an empty string with `Number("")` gives 0, which would turn "city-wide" into
 * "deliver nowhere" the first time somebody cleared the box.
 */
function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const text = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
    card: {
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.md,
    },
    cardTitle: { ...typography.label, color: c.textSecondary },
    rowCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
    },
    rowBody: { flex: 1, gap: 2 },
    rowLabel: { ...typography.body, fontSize: 16, color: c.text },
    rowMeta: { ...typography.small, color: c.textMuted },
    toggle: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
    note: { ...typography.small, color: c.textMuted, lineHeight: 19 },
  });
