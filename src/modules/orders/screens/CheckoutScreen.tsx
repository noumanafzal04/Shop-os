import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BagIcon,
  BanknoteIcon,
  ChevronRightIcon,
  ClockIcon,
  ConfettiIcon,
  MapPinIcon,
  MotorcycleIcon,
  StorefrontIcon,
  TicketIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { Touchable } from "../../../common/ui/Touchable";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { ApiError } from "../../../common/types/api";
import { apiGet } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useCartStore } from "../../../stores/cartStore";
import { useLocationStore } from "../../../stores/locationStore";
import { useMarketShop } from "../../marketplace/hooks/useMarketplace";
import { usePlaceOrder } from "../hooks/useOrders";
import { SignInWall } from "../../auth/components/SignInWall";
import { useAuthStore } from "../../../stores/authStore";
import { money } from "../../../common/format";

type Params = { Checkout: { slug: string } };

interface SavedAddress {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
}

/** Friendly copy for the COD errors the backend enforces. */
const ERROR_COPY: Record<string, string> = {
  SHOP_CLOSED: "This shop is closed right now — try again during business hours.",
  OUT_OF_DELIVERY_AREA: "", // server message already explains the distance
  MIN_ORDER_QTY: "",
  INSUFFICIENT_STOCK: "Something in your cart just sold out — adjust the quantity and retry.",
};

/**
 * WHICH WAY AN ORDER GOES WHEN NOBODY HAS SAID.
 *
 * ── Why this is a function and not three lines in an effect ──────────
 *
 * It decides the single most consequential field on the screen. The checkout
 * defaulted to **pickup**, and `RiderService::beginOffering` only runs for a
 * DELIVERY order — so every order placed without touching the toggle bypassed
 * the entire rider half of the product, correctly and silently. "Rider side no
 * order coming" survived three other fixes before this was found.
 *
 * A marketplace that delivers must not ask everybody to opt in to the thing it
 * is for. So: delivery, where the shop delivers.
 *
 * ── The two things it must not do ────────────────────────────────────
 *
 * Offer a mode the shop cannot honour, and override a person who has chosen.
 * The shop arrives AFTER this screen mounts, so the preference has to be
 * applied in an effect — and an effect that runs on every shop refetch would
 * quietly undo somebody who had deliberately picked Pickup. `chosen` is what
 * stops that: once a person touches the control, the app has no opinion.
 */
export function preferredFulfillment(opts: {
  current: "pickup" | "delivery";
  canDeliver: boolean;
  canPickup: boolean;
  chosen: boolean;
}): "pickup" | "delivery" {
  const { current, canDeliver, canPickup, chosen } = opts;

  // A mode the shop does not offer is never the answer, chosen or not: the
  // server would refuse it, and the refusal would arrive at the last step.
  if (current === "delivery" && !canDeliver) return "pickup";
  if (current === "pickup" && !canPickup) return "delivery";

  // Their choice stands.
  if (chosen) return current;

  return canDeliver ? "delivery" : "pickup";
}

export function CheckoutScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const { slug } = useRoute<RouteProp<Params, "Checkout">>().params;

  const cart = useCartStore();
  const status = useAuthStore((s) => s.status);
  const pin = useLocationStore();
  const shop = useMarketShop(slug, { lat: pin.lat ?? undefined, lng: pin.lng ?? undefined });
  const place = usePlaceOrder();

  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: async () => (await apiGet<SavedAddress[]>("/customer/addresses")).data,
  });

  /**
   * ── DELIVERY IS THE DEFAULT, WHERE THE SHOP DELIVERS ────────────
   *
   * This was `useState("pickup")`, and it is why "rider side no order coming"
   * survived three other fixes: `beginOffering` only runs for a DELIVERY
   * order, so every test order placed without touching this toggle was a
   * pickup order and correctly never reached a rider. Nothing was broken in
   * the rider half at all — the orders were never for it.
   *
   * `chosen` is what keeps the correction honest: the shop loads after this
   * screen mounts, so the preference has to be applied in an effect, and an
   * effect that runs on every shop refetch would silently undo somebody who
   * had deliberately picked Pickup. Once a person touches the control, the
   * app stops having an opinion.
   */
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("delivery");
  const [chosen, setChosen] = useState(false);
  const [address, setAddress] = useState("");
  /**
   * THE PRECISE BIT, typed for THIS delivery.
   *
   * A saved address is an area and a pin — "House 214, Street 7, Gulberg III".
   * What a rider standing in that street still needs is the flat, the floor,
   * the gate: the part that changes between one order and the next and does
   * not belong in a profile.
   *
   * It goes on the ORDER rather than on the address, because that is who needs
   * it. `customer_addresses.address` is one free-text field with no room for a
   * second meaning, and a schema change to store a flat number would be
   * storing it in the wrong place anyway.
   */
  const [detail, setDetail] = useState("");
  const [coupon, setCoupon] = useState("");
  const [notes, setNotes] = useState("");


  const lines = cart.shopSlug === slug ? cart.lines : [];
  const canDeliver = shop.data?.fulfillment?.delivery ?? shop.data?.features?.delivery ?? false;
  const canPickup = shop.data?.fulfillment?.pickup ?? true;
  const closed = shop.data?.is_open_now === false;

  // Snap to a mode the shop actually offers, and — until somebody chooses —
  // prefer delivery. ONE assignment from one rule: three sequential `if`s each
  // calling setState in the same run is two of them overwriting the third, in
  // an order that depends on the order they were written in.
  useEffect(() => {
    if (!shop.data) return;
    const want = preferredFulfillment({ current: fulfillment, canDeliver, canPickup, chosen });
    if (want !== fulfillment) setFulfillment(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.data]);

  // Delivery economics (display estimates — the server is authoritative).
  const subtotal = cart.subtotal();
  const freeAbove = shop.data?.free_delivery_threshold ?? null;
  const earnedFreeDelivery = freeAbove != null && subtotal >= freeAbove;
  const deliveryFee = fulfillment === "delivery" && !earnedFreeDelivery ? (shop.data?.delivery_fee ?? 0) : 0;
  const total = subtotal + deliveryFee;
  const minOrder = shop.data?.min_order_amount ?? null;
  const belowMinimum = fulfillment === "delivery" && minOrder != null && subtotal < minOrder;

  const itemCount = lines.reduce(
    (n, l) => n + (l.sold_by === "weight" ? 1 : l.quantity),
    0,
  );
  const prep = shop.data?.prep_time_minutes ?? null;

  /**
   * THE DEFAULT ONE, and no picker here.
   *
   * Checkout used to list every saved address as a radio, then as a panel that
   * opened one. Both put the choosing on the screen where money changes hands
   * — and the shopper already has a screen for it, with the map, the labels and
   * the delete button on it.
   *
   * So this FOLLOWS the default and "Change" walks to Addresses. Making one
   * the default there is the choice, and coming back re-reads it because that
   * screen invalidates the same query. No local `addressId` to drift out of
   * step with what the account actually says.
   */
  const saved = addresses.data ?? [];
  const selected = saved.find((a) => a.is_default) ?? saved[0] ?? null;

  /**
   * What the rider is handed: the flat first, then the area.
   *
   * That order on purpose. Somebody reading it on a phone at a gate wants the
   * part that is different from everything around them, and "Flat 3B" after
   * forty characters of area is the part they scroll past.
   */
  const deliveryText = [detail.trim(), selected ? selected.address : address.trim()]
    .filter((part) => part !== "")
    .join(" — ");
  const deliveryReady = fulfillment !== "delivery" || deliveryText.length > 0;

  const apiError = place.error instanceof ApiError ? place.error : null;
  const error = apiError
    ? ERROR_COPY[apiError.errorCode ?? ""] || apiError.firstFieldError() || apiError.message
    : null;

  const submit = () => {
    if (lines.length === 0 || place.isPending || !deliveryReady) return;
    // The pin: the saved address's own coordinates, else the one the shopper
    // set for themselves. Not "the live GPS pin" any more — the store stopped
    // re-detecting on every launch, so `pin` is now the place they chose and
    // kept rather than wherever the phone happens to be standing.
    const lat = selected?.latitude ?? pin.lat ?? undefined;
    const lng = selected?.longitude ?? pin.lng ?? undefined;
    place.mutate(
      {
        shop_slug: slug,
        fulfillment_type: fulfillment,
        delivery_address: fulfillment === "delivery" ? deliveryText : undefined,
        latitude: fulfillment === "delivery" ? lat : undefined,
        longitude: fulfillment === "delivery" ? lng : undefined,
        coupon_code: coupon.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({
          product_id: l.product_id,
          variant_id: l.variant_id ?? undefined,
          quantity: l.quantity,
          modifier_option_ids: l.modifier_option_ids?.length ? l.modifier_option_ids : undefined,
        })),
      },
      {
        onSuccess: (res) => {
          cart.clear();
          // Straight to live tracking for the order we just placed.
          const id = res?.data?.id;
          if (id) navigation.navigate("Order", { id });
          else navigation.navigate("Tabs", { screen: "OrdersTab" });
        },
      },
    );
  };

  // An order has to belong to somebody. Asked HERE rather than at the door of
  // the app, and asked with the basket still assembled behind it — see
  // `SignInWall` for why this is a panel and not a redirect.
  if (status !== "authenticated") {
    return (
      <SafeScreen backgroundColor={c.bg}>
        <SignInWall
          icon={BagIcon}
          title="Sign in to place your order"
          message="Your basket is saved. We need an account so the shop knows who to deliver to and you can follow the order."
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen backgroundColor={c.bg}>
      {/*
        A header with a way out.

        This screen is a modal with no navigation bar, and the only way back
        was an outline button below the totals — under a form long enough that
        reaching it meant scrolling past everything you had just filled in.
        On Android the hardware key worked and nothing on screen said so.
      */}
      <ScreenHeader title="Checkout" subtitle={shop.data?.business_name} />

      {/*
        The longest form in the app — address, phone, notes — with Place Order
        pinned under it. A plain ScrollView puts the keyboard straight over the
        button the person is trying to reach, on the one screen where being
        unable to reach it costs the order.
      */}
      <KeyboardScreen
        contentStyle={styles.content}
        footer={
          <View style={styles.bar}>
            <AppButton
              title={place.isPending ? "Placing order…" : `Place order · ${money(total)}`}
              onPress={submit}
              loading={place.isPending}
              disabled={lines.length === 0 || !deliveryReady || belowMinimum}
              size="lg"
            />
          </View>
        }
      >

        {closed && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>This shop is closed right now — orders will fail until it opens.</Text>
          </View>
        )}
        {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

        {/*
          What is in the order, as ONE line.

          The whole basket was listed here with a stepper on every row — a
          second cart, on the screen whose job is to confirm and pay. Eleven
          items pushed the address, the total and the button off the bottom,
          and the two copies could not disagree only because they shared a
          store: they still made the same screen twice.

          Changing your mind belongs in the basket, which is one tap away and
          says so.
        */}
        <Pressable
          style={({ pressed }) => [styles.basket, pressed && styles.basketPressed]}
          accessibilityRole="button"
          accessibilityLabel="Edit your basket"
          onPress={() => navigation.goBack()}
        >
          <View style={styles.basketIcon}>
            <BagIcon size={18} color={c.onPrimary} />
          </View>
          <View style={styles.basketCopy}>
            <Text style={styles.basketCount}>
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </Text>
            <Text style={styles.basketShop} numberOfLines={1}>
              from {shop.data?.business_name ?? "this shop"}
            </Text>
          </View>
          <Text style={styles.basketEdit}>Edit</Text>
          <ChevronRightIcon size={16} color={c.textMuted} />
        </Pressable>

        {/*
          Delivery or pickup, as ONE control with two halves.

          Two separate chips both look pressable and neither looks pressED, so
          the screen never said which mode you were in — while this choice
          decides the address block, the fee and the minimum below it. A single
          track with one filled half can only ever show one answer.
        */}
        <Text style={styles.section}>How do you want it?</Text>
        <View style={styles.segment}>
          {canPickup && (
            <Pressable
              style={[styles.seg, fulfillment === "pickup" && styles.segOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: fulfillment === "pickup" }}
              onPress={() => {
                setChosen(true);
                setFulfillment("pickup");
              }}
            >
              <StorefrontIcon
                size={15}
                color={fulfillment === "pickup" ? c.onPrimary : c.textSecondary}
              />
              <Text style={[styles.segTxt, fulfillment === "pickup" && styles.segTxtOn]}>Pickup</Text>
            </Pressable>
          )}
          {canDeliver && (
            <Pressable
              style={[styles.seg, fulfillment === "delivery" && styles.segOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: fulfillment === "delivery" }}
              onPress={() => {
                setChosen(true);
                setFulfillment("delivery");
              }}
            >
              <MotorcycleIcon
                size={15}
                color={fulfillment === "delivery" ? c.onPrimary : c.textSecondary}
              />
              <Text style={[styles.segTxt, fulfillment === "delivery" && styles.segTxtOn]}>
                Delivery
                {(shop.data?.delivery_fee ?? 0) > 0 ? ` · ${money(shop.data!.delivery_fee!)}` : ""}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Where it is going — stated first, changed on request */}
        {fulfillment === "delivery" && (
          <View style={styles.addrBlock}>
            {/*
              THE ONE SENTENCE THIS SCREEN HAS TO GET RIGHT, and the one field
              that finishes it.

              A wrong address is a rider at a stranger's gate and an order
              nobody can hand back. So the saved address is stated in full at
              the top — read, not scanned — and "Change" WALKS to the address
              page rather than opening a picker here.

              That is the change. Checkout used to list every saved address as
              a radio, then as a panel that opened one; both put the choosing
              on the screen where money changes hands, when the shopper already
              has a screen for it with the map, the labels and the delete
              button on it. Making one the default there is the choice, and
              coming back re-reads it.
            */}
            <Touchable
              style={styles.chosen}
              accessibilityRole="button"
              accessibilityLabel={
                selected === null
                  ? "Add a delivery address"
                  : `Delivering to ${selected.label}, ${selected.address}. Change`
              }
              onPress={() => navigation.navigate("Addresses")}
            >
              <MapPinIcon size={16} color={c.brand[600]} />
              <View style={styles.chosenInfo}>
                <Text style={styles.chosenCap}>Delivering to</Text>
                {selected === null ? (
                  <Text style={styles.chosenEmpty}>Add an address</Text>
                ) : (
                  <>
                    <Text style={styles.chosenLabel}>{selected.label}</Text>
                    {/* Three lines, not one. A truncated address cannot be
                        checked, and checking it is the entire purpose. */}
                    <Text style={styles.chosenText} numberOfLines={3}>{selected.address}</Text>
                  </>
                )}
              </View>
              <Text style={styles.chosenChange}>{selected === null ? "Add" : "Change"}</Text>
            </Touchable>

            {/*
              THE PART THE SAVED ADDRESS CANNOT HOLD.

              An area and a pin get a rider to the street. The flat, the floor
              and the gate are what get them to the door, and they change
              between one order and the next — so they are typed here and sent
              with the ORDER rather than saved onto the profile.
            */}
            {selected !== null && (
              <View style={styles.detailWrap}>
                <AppTextInput
                  label="House / flat / floor"
                  value={detail}
                  onChangeText={setDetail}
                  placeholder="House 12, second floor, green gate"
                />
              </View>
            )}

            {/*
              NO SAVED ADDRESS AT ALL — the one case that still types here.
              Sending somebody to another screen before they can order at all
              is a wall; this is the same box the address page has, so nothing
              is lost by filling it in either place.
            */}
            {selected === null && (
              <AppTextInput
                value={address}
                onChangeText={setAddress}
                placeholder="House, street, area…"
              />
            )}

            {shop.data?.delivers_to_me === false && (
              <View style={styles.rangeWarnRow}>
                <AlertTriangleIcon size={13} color={c.warning} />
                <Text style={styles.rangeWarn}>
                  Your current pin looks outside this shop's delivery range.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Coupon + notes */}
        <View style={styles.couponRow}>
          <View style={styles.couponInput}>
            <AppTextInput
              icon={TicketIcon}
              placeholder="Coupon code (optional)"
              value={coupon}
              onChangeText={(v) => setCoupon(v.toUpperCase())}
              autoCapitalize="characters"
            />
          </View>
        </View>
        <AppTextInput placeholder="Notes for the shop (optional)" value={notes} onChangeText={setNotes} />

        {belowMinimum && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              Minimum order for delivery is {money(minOrder!)} — add {money(minOrder! - subtotal)} more, or switch to pickup.
            </Text>
          </View>
        )}
        {fulfillment === "delivery" && earnedFreeDelivery && (
          <View style={styles.freeBox}>
            <ConfettiIcon size={16} color={c.success} />
            <Text style={styles.freeText}>You've earned FREE delivery!</Text>
          </View>
        )}

        <Text style={styles.section}>Order summary</Text>
        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLbl}>Subtotal</Text>
            <Text style={styles.totalVal}>{money(subtotal)}</Text>
          </View>
          {fulfillment === "delivery" && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLbl}>Delivery fee</Text>
              {earnedFreeDelivery ? (
                <Text style={styles.totalFree}>FREE</Text>
              ) : (
                <Text style={styles.totalVal}>{money(deliveryFee)}</Text>
              )}
            </View>
          )}
          {!!coupon.trim() && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLbl}>Coupon {coupon.trim()}</Text>
              <Text style={styles.totalHint}>checked when you order</Text>
            </View>
          )}
          <View style={styles.totalRule} />
          <View style={styles.totalRow}>
            <Text style={styles.grand}>Total</Text>
            <Text style={styles.grandVal}>{money(total)}</Text>
          </View>
        </View>

        {/*
          The shop's own preparation time, and ONLY when it has set one.
          A default invents "30–50 min" for a shop that never said, which is a
          promise the app made on its behalf.
        */}
        {prep !== null && (
          <View style={styles.eta}>
            <ClockIcon size={15} color={c.textSecondary} />
            <Text style={styles.etaText}>
              {fulfillment === "delivery"
                ? `Estimated delivery: ${prep}–${prep + 20} min`
                : `Ready for pickup in about ${prep} min`}
            </Text>
          </View>
        )}

        <Text style={styles.section}>Payment method</Text>
        <View style={styles.payRow}>
          <BanknoteIcon size={19} color={c.success} />
          <View style={styles.payCopy}>
            <Text style={styles.payText}>Cash on delivery</Text>
            <Text style={styles.payHint}>Pay when you receive your order</Text>
          </View>
          {/* Selected, and the only option — drawn rather than implied. */}
          <View style={styles.radio}>
            <View style={styles.radioDot} />
          </View>
        </View>

      </KeyboardScreen>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },

  /** The pinned action bar — see `KeyboardScreen`'s `footer`. */
  bar: {
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  basket: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  basketPressed: { backgroundColor: c.surfaceAlt },
  basketIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  basketCopy: { flex: 1 },
  basketCount: { ...typography.label, color: c.text, fontSize: 14.5 },
  basketShop: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
  basketEdit: { ...typography.small, color: c.primary, fontWeight: "700" },

  eta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  etaText: { ...typography.small, color: c.textSecondary },

  payCopy: { flex: 1 },
  payHint: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary },

  segment: {
    flexDirection: "row",
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    // The track around the buttons — see the note on the shop page's toggle.
    borderRadius: 21,
    padding: 4,
    gap: 4,
    marginBottom: spacing.sm,
  },
  seg: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: 20,
  },
  segOn: { backgroundColor: c.primary },
  segTxt: { ...typography.small, color: c.textSecondary, fontWeight: "600" },
  segTxtOn: { color: c.onPrimary },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  payText: { ...typography.label, color: c.text, flex: 1, fontSize: 14 },

  warnBox: { backgroundColor: c.warningBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  warnText: { ...typography.small, color: c.warning },
  freeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.successBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  freeText: { ...typography.small, color: c.success, fontWeight: "700" },
  errorBox: { backgroundColor: c.errorBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  errorText: { ...typography.small, color: c.error },


  section: { ...typography.label, color: c.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  chips: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  chipActive: { backgroundColor: c.brand[500], borderColor: c.brand[500] },
  chipTxt: { color: c.gray[600], fontSize: 13, fontWeight: "500" },
  chipTxtActive: { color: c.white },

  addrBlock: { gap: spacing.xs, marginBottom: spacing.sm },
  addr: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  addrOn: { borderColor: c.brand[500], backgroundColor: c.brand[50] },
  addrInfo: { flex: 1, gap: 1 },
  addrLabel: { ...typography.label, color: c.text, fontSize: 13 },
  addrText: { ...typography.tiny, color: c.gray[500] },

  /**
   * The address as a STATEMENT, not as one option among several.
   *
   * Tinted rather than plain, because on a screen of grey cards the one thing
   * that must be read has to look unlike the things that are only scanned. The
   * brand tint is the same one the chosen row carries, so nothing new is being
   * taught — it is the selected state, given the whole width.
   */
  chosen: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: c.brand[50],
    borderWidth: 1,
    borderColor: c.brand[200],
    borderRadius: radius.md,
    padding: spacing.md,
  },
  chosenInfo: { flex: 1, gap: 2 },
  chosenCap: { ...typography.tiny, color: c.brand[700], textTransform: "uppercase", letterSpacing: 0.6 },
  chosenLabel: { ...typography.label, color: c.text, fontSize: 13 },
  chosenText: { ...typography.body, color: c.text, fontSize: 14, lineHeight: 19 },
  chosenEmpty: { ...typography.body, color: c.textMuted, fontSize: 14 },
  /** A word, not a button — the whole row is the target. */
  chosenChange: { ...typography.label, color: c.brand[600], fontSize: 13 },

  /**
   * Tucked under the address card, not floating beside it.
   *
   * The two belong together — one is where, the other is which door — so a
   * small negative top pulls the field up against the card it completes
   * rather than letting the block's own gap read as a separator.
   */
  detailWrap: { marginTop: 2 },

  rangeWarnRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  rangeWarn: { ...typography.tiny, color: c.warning, flex: 1 },

  couponRow: { marginTop: spacing.xs },
  couponInput: { marginBottom: spacing.xs },

  totals: {
    marginTop: spacing.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 },
  totalLbl: { ...typography.small, color: c.textSecondary },
  totalVal: { ...typography.small, color: c.text, fontWeight: "600" },
  totalFree: { ...typography.small, color: c.success, fontWeight: "800" },
  totalHint: { ...typography.tiny, color: c.textMuted },
  totalRule: { height: 1, backgroundColor: c.border, marginVertical: 8 },
  grand: { ...typography.h3, fontSize: 16, color: c.text },
  grandVal: { ...typography.title, fontSize: 21, color: c.primary },
});
