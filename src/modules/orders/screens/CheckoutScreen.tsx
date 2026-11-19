import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BagIcon,
  BanknoteIcon,
  ChevronRightIcon,
  ConfettiIcon,
  MapPinIcon,
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
import { makeKey, useOrderWorth, usePlaceOrder } from "../hooks/useOrders";
import { moneyLineValue, orderMoneyLines } from "../orderMoney";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { SignInWall } from "../../auth/components/SignInWall";
import { useAuthStore } from "../../../stores/authStore";
import { money, qtyText } from "../../../common/format";

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
  const scrollRef = useRef<ScrollView>(null);

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


  // One array for as long as the cart is unchanged — the order put to the
  // server for its price is keyed on it, and a fresh `[]` every render would
  // be a fresh question every render.
  const lines = useMemo(() => (cart.shopSlug === slug ? cart.lines : []), [cart.shopSlug, cart.lines, slug]);
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

  /**
   * WHAT IT COMES TO — the shop's own figure, never a sum done here.
   *
   * Tax, the shop's offer, a member's discount, the coupon and the delivery
   * are all decided by the server (an order is priced like the till), so the
   * order is put to it and the answer is what the screen and the button say.
   * Asked once the person stops typing; an unchanged order is not asked again.
   */
  const askedNow = useMemo(() => {
    const lat = selected?.latitude ?? pin.lat ?? undefined;
    const lng = selected?.longitude ?? pin.lng ?? undefined;

    return JSON.stringify({
      shop_slug: slug,
      fulfillment_type: fulfillment,
      latitude: fulfillment === "delivery" ? lat : undefined,
      longitude: fulfillment === "delivery" ? lng : undefined,
      coupon_code: coupon.trim() || undefined,
      items: lines.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id ?? undefined,
        quantity: l.quantity,
        modifier_option_ids: l.modifier_option_ids?.length ? l.modifier_option_ids : undefined,
      })),
    });
  }, [slug, fulfillment, coupon, lines, selected?.latitude, selected?.longitude, pin.lat, pin.lng]);
  const asked = useDebouncedValue(askedNow, 400);
  const worth = useOrderWorth(asked, status === "authenticated" && lines.length > 0);
  // The figures on screen are for THIS order — not the one before the last tap.
  const priced = worth.data && asked === askedNow && !worth.isFetching ? worth.data : null;
  const shown = worth.data ?? null; // kept up while the next answer is on its way
  const refused = worth.error instanceof ApiError ? worth.error.firstFieldError() || worth.error.message : null;

  /**
   * ONE ORDER, ONE KEY — for the whole attempt.
   *
   * Minted at the press, a dropped answer and a second press would be two
   * orders for one basket. Held here from the first press until the order is
   * placed, a retry is the same order and the server hands back the first.
   */
  const orderKey = useRef(makeKey());

  const apiError = place.error instanceof ApiError ? place.error : null;
  const error = apiError
    ? ERROR_COPY[apiError.errorCode ?? ""] || apiError.firstFieldError() || apiError.message
    : null;

  const submit = () => {
    if (lines.length === 0 || place.isPending || !deliveryReady || !priced) return;
    // The pin: the saved address's own coordinates, else the one the shopper
    // set for themselves. Not "the live GPS pin" any more — the store stopped
    // re-detecting on every launch, so `pin` is now the place they chose and
    // kept rather than wherever the phone happens to be standing.
    const lat = selected?.latitude ?? pin.lat ?? undefined;
    const lng = selected?.longitude ?? pin.lng ?? undefined;
    place.mutate(
      {
        idempotency_key: orderKey.current,
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
          orderKey.current = makeKey();
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
        scrollRef={scrollRef}
        contentStyle={styles.content}
        footer={
          <View style={styles.bar}>
            {/*
              The total, said before the button — what is in it, and a way
              down to the bill — on a card rising off the page, as the
              reference checkout ends.
            */}
            <View style={styles.barTotal}>
              <View>
                <Text style={styles.barLabel}>
                  Total <Text style={styles.barHint}>(incl. fees and tax)</Text>
                </Text>
                <Text
                  style={styles.barLink}
                  accessibilityRole="link"
                  onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
                >
                  See summary
                </Text>
              </View>
              <Text style={styles.barValue}>{priced ? money(priced.total) : "…"}</Text>
            </View>
            <AppButton
              title={place.isPending ? "Placing order…" : priced ? `Place order · ${money(priced.total)}` : refused ? "Place order" : "Working out the total…"}
              onPress={submit}
              loading={place.isPending}
              disabled={lines.length === 0 || !deliveryReady || belowMinimum || !priced}
              size="lg"
              style={styles.barButton}
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

        {/* Where it is going — stated first, changed on request */}
        {fulfillment === "delivery" && <Text style={styles.section}>Delivering to</Text>}
        {fulfillment === "delivery" && (
          <View style={[styles.card, styles.addrBlock]}>
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

        {/*
          ── DELIVERY OPTIONS, as the reference draws them ───────────────

          Radio cards rather than a two-half switch: each says what it is,
          how long, and what it costs, and the chosen one wears a ring. It
          decides the address block above, the fee and the minimum below.
        */}
        <Text style={styles.section}>{canDeliver && canPickup ? "Delivery options" : canDeliver ? "Delivery" : "Pick-up"}</Text>
        <View style={styles.options}>
          {canDeliver && (
            <Option
              styles={styles}
              selected={fulfillment === "delivery"}
              title="Delivery"
              detail={prep !== null ? `${prep} – ${prep + 20} min` : "To your address"}
              extra={(shop.data?.delivery_fee ?? 0) > 0 ? money(shop.data!.delivery_fee!) : "Free"}
              onPress={() => {
                setChosen(true);
                setFulfillment("delivery");
              }}
            />
          )}
          {canPickup && (
            <Option
              styles={styles}
              selected={fulfillment === "pickup"}
              title="Pick-up"
              detail={prep !== null ? `Ready in about ${prep} min` : "Collect it from the shop"}
              extra="Free"
              onPress={() => {
                setChosen(true);
                setFulfillment("pickup");
              }}
            />
          )}
        </View>

        <Text style={styles.section}>Payment method</Text>
        <View style={[styles.card, styles.payRow]}>
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

        <Text style={styles.section}>Voucher and note</Text>
        <View style={[styles.card, styles.cardPad]}>
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

        </View>

        {/* Said once: the server's refusal under the bill says the same thing. */}
        {belowMinimum && !refused && (
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



          {/* What is in it, line by line — the reference lists every item. */}
          {lines.map((l) => (
            <View key={`${l.product_id}:${l.variant_id ?? "-"}:${l.modifiers_label ?? ""}`} style={styles.itemRow}>
              <Text style={styles.itemQty}>{qtyText(l.quantity)}×</Text>
              <Text style={styles.itemName} numberOfLines={2}>
                {l.name}
                {l.modifiers_label ? ` · ${l.modifiers_label}` : ""}
              </Text>
              <Text style={styles.itemPrice}>{money(l.unit_price * l.quantity)}</Text>
            </View>
          ))}
          <View style={styles.totalRule} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLbl}>Subtotal</Text>
            <Text style={styles.totalVal}>{money(shown ? shown.subtotal : subtotal)}</Text>
          </View>
          {/* Every line below is the server's — coupon, offer, member
              discount, tax, delivery, total. Nothing is added up here. */}
          {shown ? (
            orderMoneyLines(shown, fulfillment)
              .filter((line) => line.kind !== "goods" && line.kind !== "total")
              .map((line) => (
                <View key={line.key} style={styles.totalRow}>
                  <Text style={styles.totalLbl}>{line.label}</Text>
                  <Text style={line.kind === "off" ? styles.totalOff : line.kind === "delivery" && line.amount === 0 ? styles.totalFree : styles.totalVal}>
                    {moneyLineValue(line, money)}
                  </Text>
                </View>
              ))
          ) : null}
          {refused && (
            <View style={styles.totalRow}>
              <Text style={styles.refusedText}>{refused}</Text>
            </View>
          )}
          <View style={styles.totalRule} />
          <View style={styles.totalRow}>
            <Text style={styles.grand}>Total</Text>
            <Text style={styles.grandVal}>{shown ? money(shown.total) : "…"}</Text>
          </View>
        </View>
        <Text style={styles.terms}>By placing this order you agree to the terms of service.</Text>

      </KeyboardScreen>
    </SafeScreen>
  );
}

function Option({
  styles,
  selected,
  title,
  detail,
  extra,
  onPress,
}: {
  styles: ReturnType<typeof makeStyles>;
  selected: boolean;
  title: string;
  detail: string;
  extra: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.option, selected && styles.optionOn]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      <View style={[styles.radioOuter, selected && styles.radioOuterOn]} />
      <View style={styles.optionCopy}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionDetail}>{detail}</Text>
      </View>
      <View style={styles.optionTag}>
        <Text style={styles.optionTagText}>{extra}</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.lg },

  /** The pinned action bar — see `KeyboardScreen`'s `footer`. */
  bar: {
    backgroundColor: c.surface,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.ms,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -2 },
    elevation: 10,
  },
  barTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  barLabel: { ...typography.name, color: c.text, fontWeight: "700" },
  barHint: { ...typography.caption, color: c.textSecondary, fontWeight: "400" },
  barLink: { ...typography.small, color: c.text, textDecorationLine: "underline", marginTop: 2 },
  barValue: { ...typography.total, color: c.text },
  barButton: { borderRadius: 26 },

  // The first row of the summary card: what is in it, and the way back to change it.
  basket: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.ms,
    marginBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
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
  basketCount: { ...typography.label, color: c.text, fontSize: 15, lineHeight: 22 },
  basketShop: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
  basketEdit: { ...typography.small, color: c.primary, fontWeight: "700" },

  eta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
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
    padding: spacing.md,
  },
  payText: { ...typography.label, color: c.text, flex: 1, fontSize: 14, lineHeight: 18 },

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


  section: { ...typography.h3, color: c.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  // Every step of checkout is its own white card on the page ground — the
  // address, the payment, the voucher, the bill — so the eye reads it as a
  // short list of things to confirm rather than one long form.
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
  },
  options: { gap: spacing.sm },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
  },
  // The chosen card wears a ring in the text colour, as the reference does.
  optionOn: { borderColor: c.text, borderWidth: 1.5 },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.border },
  radioOuterOn: { borderWidth: 7, borderColor: c.text },
  optionCopy: { flex: 1, gap: 2 },
  optionTitle: { ...typography.name, color: c.text, fontWeight: "700" },
  optionDetail: { ...typography.small, color: c.textSecondary },
  optionTag: { borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  optionTagText: { ...typography.caption, color: c.text, fontWeight: "700" },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 3 },
  itemQty: { ...typography.label, color: c.text, width: 30 },
  itemName: { ...typography.body, color: c.text, flex: 1 },
  itemPrice: { ...typography.body, color: c.text },
  terms: { ...typography.caption, color: c.textMuted, marginTop: spacing.sm },
  cardPad: { padding: spacing.md, gap: spacing.sm },
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
  chipTxt: { color: c.gray[600], fontSize: 13, lineHeight: 18, fontWeight: "500" },
  chipTxtActive: { color: c.white },

  addrBlock: { gap: spacing.sm, padding: spacing.ms },
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
  addrLabel: { ...typography.label, color: c.text, fontSize: 13, lineHeight: 18 },
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
    borderRadius: radius.sm,
    padding: spacing.ms,
  },
  chosenInfo: { flex: 1, gap: 2 },
  chosenCap: { ...typography.tiny, color: c.brand[700], textTransform: "uppercase", letterSpacing: 0.6 },
  chosenLabel: { ...typography.label, color: c.text, fontSize: 13, lineHeight: 18 },
  chosenText: { ...typography.body, color: c.text, fontSize: 14, lineHeight: 18 },
  chosenEmpty: { ...typography.body, color: c.textMuted, fontSize: 14, lineHeight: 18 },
  /** A word, not a button — the whole row is the target. */
  chosenChange: { ...typography.label, color: c.brand[600], fontSize: 13, lineHeight: 18 },

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
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 },
  totalLbl: { ...typography.small, color: c.textSecondary },
  totalVal: { ...typography.small, color: c.text, fontWeight: "600" },
  totalFree: { ...typography.small, color: c.success, fontWeight: "800" },
  totalOff: { ...typography.small, color: c.success, fontWeight: "700" },
  refusedText: { ...typography.small, color: c.error, flex: 1 },
  totalRule: { height: 1, backgroundColor: c.border, marginVertical: 8 },
  grand: { ...typography.h3, fontSize: 16, lineHeight: 22, color: c.text },
  grandVal: { ...typography.title, fontSize: 22, lineHeight: 28, color: c.primary },
});
