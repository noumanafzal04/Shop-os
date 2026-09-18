import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { KeyboardScreen } from "@cartze/core/ui/KeyboardScreen";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { AppButton } from "@cartze/core/ui/AppButton";
import { SmartImage } from "@cartze/core/ui/SmartImage";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { toast } from "@cartze/core/ui/toast";
import { ApiError } from "@cartze/core/types/api";
import { money, qtyText } from "@cartze/core/format";
import { BoxIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useProduct, useSoldOut, useUpdateProduct } from "../hooks/useCatalog";
import type { MenuStackParamList } from "../../../navigation/types";

/**
 * ONE ITEM, AND THE THREE THINGS A PHONE SHOULD CHANGE.
 *
 * Name, price, and whether it is on the menu at all. Categories, variants,
 * modifiers, recipes and stock belong to the panel — a form that offers
 * everything on a phone is one nobody finishes, and this app is opened
 * standing up.
 *
 * The photo is shown but not edited here: replacing it is `Phase 3b`, and a
 * button that does nothing is worse than one that is absent.
 */
export function ProductDetailScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<MenuStackParamList, "ProductDetail">>();

  const { data: product, isLoading, isError, refetch } = useProduct(params.id);
  const update = useUpdateProduct();
  const soldOut = useSoldOut();

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [touched, setTouched] = useState(false);

  /**
   * The form fills from the server ONCE.
   *
   * `touched` is the fence. Without it, a background refetch — the queue
   * polls, and react-query refocuses — would overwrite whatever somebody is
   * halfway through typing, which is the worst possible moment to lose an
   * edit and the hardest to reproduce afterwards.
   */
  useEffect(() => {
    if (!product || touched) return;
    setName(product.name);
    setPrice(String(product.price ?? ""));
  }, [product, touched]);

  const off = product?.sold_out_at != null;
  const changed =
    !!product && touched && (name !== product.name || price !== String(product.price ?? ""));

  async function save() {
    if (!product || !changed) return;

    const asNumber = Number(price);
    if (!Number.isFinite(asNumber) || asNumber < 0) {
      toast.error("Enter a price as a number, like 450");
      return;
    }

    try {
      await update.mutateAsync({
        id: product.id,
        changes: { name: name.trim(), price: asNumber },
      });
      setTouched(false);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "Could not save");
    }
  }

  async function toggleSoldOut() {
    if (!product) return;
    try {
      await soldOut.mutateAsync({ id: product.id, soldOut: !off });
      toast.success(off ? "Back on the menu" : "Taken off the menu");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update the menu");
    }
  }

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader title={product?.name ?? "Item"} onBack={() => nav.goBack()} />

      {isLoading && !product ? (
        <View style={s.body}>
          <Skeleton height={160} borderRadius={16} />
          <Skeleton height={180} borderRadius={16} />
        </View>
      ) : isError && !product ? (
        <View style={s.body}>
          <LoadFailed
            what="this item"
            onRetry={() => {
              void refetch();
            }}
          />
        </View>
      ) : product ? (
        <KeyboardScreen contentStyle={s.body}>
          <View style={s.photoCard}>
            {product.images?.[0]?.url ? (
              <SmartImage uri={product.images[0].url} style={s.photo} resizeMode="cover" />
            ) : (
              <View style={[s.photo, s.photoEmpty]}>
                <BoxIcon size={28} color={c.textMuted} />
                <Text style={s.photoHint}>No photo yet</Text>
              </View>
            )}
          </View>

          {/**
           * THE SOLD-OUT CONTROL, ABOVE THE FORM.
           *
           * It is the reason most people open this screen, and burying it
           * under two text fields makes somebody scroll past what they came
           * for. It says what pressing it DOES, not which state it is in.
           */}
          <Touchable
            onPress={() => void toggleSoldOut()}
            accessibilityRole="button"
            style={[s.soldOut, off ? s.soldOutOn : null]}
          >
            <Text style={[s.soldOutText, off ? s.soldOutTextOn : null]}>
              {off ? "Put back on the menu" : "Mark sold out"}
            </Text>
            {off && product.sold_out_at ? (
              <Text style={s.soldOutSince}>Off since {timeOnly(product.sold_out_at)}</Text>
            ) : null}
          </Touchable>

          <View style={s.card}>
            <AppTextInput
              label="Name"
              value={name}
              onChangeText={(t) => {
                setTouched(true);
                setName(t);
              }}
            />
            <AppTextInput
              label="Price"
              value={price}
              onChangeText={(t) => {
                setTouched(true);
                setPrice(t);
              }}
              keyboardType="numeric"
            />

            <View style={s.facts}>
              {product.sku ? <Fact label="SKU" value={product.sku} /> : null}
              {product.category?.name ? <Fact label="Category" value={product.category.name} /> : null}
              {product.track_inventory && product.stock_quantity != null ? (
                <Fact label="In stock" value={qtyText(product.stock_quantity)} />
              ) : null}
              <Fact label="Current price" value={money(product.price)} />
            </View>
          </View>

          <AppButton
            title="Save changes"
            onPress={save}
            disabled={!changed}
            loading={update.isPending}
            size="lg"
          />

          <Text style={s.foot}>
            Categories, variants, stock and photos are edited in the CartZe web panel.
          </Text>
        </KeyboardScreen>
      ) : null}
    </SafeScreen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const s = styles(useColors());
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** "3:40 pm" — the shop's own clock. A date is noise for something today. */
function timeOnly(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
    photoCard: { borderRadius: 16, overflow: "hidden", backgroundColor: c.surfaceAlt },
    photo: { width: "100%", height: 170 },
    photoEmpty: { alignItems: "center", justifyContent: "center", gap: 6 },
    photoHint: { ...typography.small, color: c.textMuted },

    soldOut: {
      borderRadius: 14,
      paddingVertical: spacing.md,
      alignItems: "center",
      gap: 2,
      backgroundColor: c.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    soldOutOn: { backgroundColor: c.primary, borderColor: c.primary },
    soldOutText: { ...typography.label, fontSize: 15, color: c.text },
    soldOutTextOn: { color: c.onPrimary },
    soldOutSince: { ...typography.tiny, fontSize: 12, color: c.onPrimary, opacity: 0.85 },

    card: {
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.md,
    },
    facts: { gap: spacing.sm },
    fact: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
    factLabel: { ...typography.small, color: c.textSecondary },
    factValue: { ...typography.small, color: c.text, flexShrink: 1 },

    foot: { ...typography.small, color: c.textMuted, textAlign: "center", lineHeight: 19 },
  });
