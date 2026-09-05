import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, ArrowRight, Bike, Clock, Heart, MapPin, Phone, Search, ShoppingBag, Star } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AddButton } from "../../../common/ui/AddButton";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { Skeleton, SkeletonMenuRow } from "../../../common/ui/Skeleton";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useAuthStore } from "../../../stores/authStore";
import { useCartStore } from "../../../stores/cartStore";
import { useLocationStore } from "../../../stores/locationStore";
import { ApiError } from "../../../common/types/api";
import { ProductSheet, type ConfiguredLine } from "../components/ProductSheet";
import type { PublicProduct } from "../services/marketplaceService";
import { productBelongsToShop } from "../linkedProduct";
import { formatDistance } from "../shopFacts";
import { shopCover, shopInitial } from "../shopCover";
import { toast } from "../../../common/ui/toast";
import { confirm } from "../../../common/ui/confirm";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { money } from "../../../common/format";
import {
  useFavorites,
  useMarketProduct,
  useMarketProducts,
  useMarketShop,
  useReserve,
  useToggleFavorite,
} from "../hooks/useMarketplace";


type Params = { MarketShop: { slug: string; productId?: string } };

/**
 * Shop page, foodpanda-style: hero image → name + rating → Delivery/Pick-up
 * toggle → delivery info card → menu search → category chips → products.
 */
export function MarketShopScreen() {
  const insets = useSafeAreaInsets();
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<Params, "MarketShop">>();
  const { slug, productId: linkedProductId } = route.params;

  const user = useAuthStore((s) => s.user);
  const isCustomer = user?.role === "customer";
  const { lat, lng } = useLocationStore();

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);
  const [catId, setCatId] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");

  const [sheetProduct, setSheetProduct] = useState<PublicProduct | null>(null);

  const shop = useMarketShop(slug, { lat: lat ?? undefined, lng: lng ?? undefined });
  const products = useMarketProducts(slug, { search: debounced, category_id: catId || undefined });
  const pull = usePullToRefresh(products.refetch);
  const favorites = useFavorites(isCustomer);
  const toggleFavorite = useToggleFavorite();
  const reserve = useReserve();
  const cart = useCartStore();

  // ── A link that named one item ────────────────────────────────────
  //
  // Fetched by id rather than searched for in `rows`: the menu pages, so a
  // link to the ninetieth dish would find nothing on the first screenful and
  // open silently on the shop instead — which looks like the link was wrong.
  const linked = useMarketProduct(linkedProductId);
  const [linkOpened, setLinkOpened] = React.useState(false);

  React.useEffect(() => {
    if (linkOpened || !linked.data) return;
    setLinkOpened(true); // once — a closed sheet must not spring back open

    // A link names a shop and an item independently — see `linkedProduct.ts`.
    if (!productBelongsToShop(linked.data, slug)) return;

    setSheetProduct(linked.data);
  }, [linked.data, linkOpened, slug]);

  // Snap the toggle to a supported mode once the shop config loads.
  React.useEffect(() => {
    if (!shop.data) return;
    const delivery = shop.data.fulfillment?.delivery ?? shop.data.features?.delivery ?? true;
    const pickup = shop.data.fulfillment?.pickup ?? true;
    if (fulfillment === "delivery" && !delivery) setFulfillment("pickup");
    if (fulfillment === "pickup" && !pickup) setFulfillment("delivery");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.data]);

  const isFavorite = (favorites.data ?? []).some((f) => f.slug === slug);
  const rows = products.data?.data ?? [];
  const canReserve = isCustomer && (shop.data?.features?.reservations ?? false);
  const acceptsOrders = isCustomer && (shop.data?.accepts_orders ?? false);
  const hasDelivery = shop.data?.fulfillment?.delivery ?? shop.data?.features?.delivery ?? true;
  const hasPickup = shop.data?.fulfillment?.pickup ?? true;
  const closed = shop.data?.is_open_now === false;
  const cartCount = cart.shopSlug === slug ? cart.count() : 0;
  const cover = shopCover(slug);
  // NOT defaulted to 30. A shop that has never set a prep time has not made a
  // promise, and `?? 30` turns that silence into one — printed as this shop's
  // own "Delivery 30–50 min" beside its own name. A kitchen that takes ninety
  // minutes is then late by the app's arithmetic, not by its own.
  //
  // The shop CARD already says nothing when it is unset; this is the same rule
  // in the other place the number is drawn.
  const prep = shop.data?.prep_time_minutes ?? null;
  const hero = shop.data?.gallery?.[0];

  /**
   * Put a line in the basket — asking first if that would empty it.
   *
   * The basket holds one shop at a time: one order, one rider, one delivery
   * fee. That is a fair rule and it used to be enforced in silence — tapping a
   * kebab with eight things already in the basket discarded all eight with no
   * word before or after, and the person found out at the cart.
   */
  const addLine = (line: Parameters<typeof cart.add>[1], qty?: number) => {
    if (!cart.wouldReplace(slug)) {
      cart.add(slug, line, qty);
      return;
    }

    confirm
      .ask({
        title: "Start a new basket?",
        message: `Your basket has items from another shop. ${shop.data?.business_name ?? "This shop"} delivers separately, so those will be removed.`,
        confirmLabel: "Start new",
        cancelLabel: "Keep my basket",
        tone: "danger",
      })
      .then((yes) => {
        if (yes) cart.add(slug, line, qty);
      })
      .catch(() => {});
  };

  /** Simple products go straight in; anything configurable opens the sheet. */
  const onAdd = (p: PublicProduct) => {
    // Refused HERE, not at checkout.
    //
    // The server refuses it either way — a prescription medicine cannot be
    // bought without a pharmacist — but it refuses at the end, after somebody
    // has chosen a shop, filled a basket and reached the last screen. The rule
    // is the shop's; the timing was ours.
    if (p.requires_prescription) {
      toast.info(`${p.name} needs a prescription`, {
        detail: "Ask the pharmacy — this one is sold in person, not online.",
      });
      return;
    }

    const needsSheet = p.variants.length > 0 || p.modifier_groups.length > 0 || p.sold_by === "weight";
    if (needsSheet) {
      setSheetProduct(p);
      return;
    }
    addLine({
      product_id: p.id,
      variant_id: null,
      name: p.name,
      unit_price: Number(p.price),
      sold_by: p.sold_by,
      unit_label: p.unit,
    });
  };

  const onConfigured = (line: ConfiguredLine) => {
    const p = sheetProduct!;
    addLine(
      {
        product_id: p.id,
        variant_id: line.variant_id,
        name: line.variant_name ? `${p.name} / ${line.variant_name}` : p.name,
        unit_price: line.unit_price,
        sold_by: p.sold_by,
        unit_label: p.unit,
        modifier_option_ids: line.modifier_option_ids.length ? line.modifier_option_ids : undefined,
        modifiers_label: line.modifiers_label,
      },
      line.quantity,
    );
    setSheetProduct(null);
  };

  const contactShop = () => {
    if (shop.data?.phone) {
      Alert.alert(shop.data.business_name, `📞 ${shop.data.phone}`);
    } else {
      Alert.alert("Sign in required", "Log in to see this shop's contact number.");
    }
  };

  const askReserve = (productId: string, name: string) => {
    Alert.alert("Reserve item", `Reserve 1 × ${name}? The shop will confirm.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reserve",
        onPress: () =>
          reserve.mutate(
            { shop_slug: slug, product_id: productId, quantity: 1 },
            {
              onSuccess: () => Alert.alert("Reserved!", "The shop will confirm your reservation shortly."),
              onError: (error) =>
                Alert.alert("Couldn't reserve", error instanceof ApiError ? error.message : "Please try again."),
            },
          ),
      },
    ]);
  };

  const header = (
    <>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        {hero ? (
          <Image source={{ uri: hero }} style={styles.heroImg} resizeMode="cover" />
        ) : (
          // The SAME derived cover as the card this shop was tapped from, so
          // opening a shop does not change what it looks like. It used to be a
          // brand-red block with a translucent white letter on it — the same
          // block for every shop, and a letter at 85% opacity that read as a
          // watermark rather than as the shop's mark.
          <View style={[styles.heroFallback, { backgroundColor: cover.bg }]}>
            <Text style={[styles.heroInitial, { color: cover.fg }]}>
              {shopInitial(shop.data?.business_name)}
            </Text>
          </View>
        )}
        <View style={styles.heroBar}>
          <Pressable style={styles.round} onPress={() => navigation.goBack()} hitSlop={8}>
            <ArrowLeft size={20} color={c.text} strokeWidth={2} />
          </Pressable>
          <View style={styles.heroRight}>
            <Pressable style={styles.round} onPress={contactShop} hitSlop={8}>
              <Phone size={18} color={c.text} strokeWidth={2} />
            </Pressable>
            {isCustomer && (
              <Pressable
                style={styles.round}
                onPress={() => toggleFavorite.mutate(slug)}
                disabled={toggleFavorite.isPending}
                hitSlop={8}
              >
                <Heart
                  size={19}
                  color={isFavorite ? c.error : c.text}
                  fill={isFavorite ? c.error : "transparent"}
                  strokeWidth={2}
                />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {/* ── Identity ─────────────────────────────────────────────── */}
      {shop.isLoading ? (
        <View style={styles.identity}>
          <Skeleton width="60%" height={22} />
          <Skeleton width="40%" height={12} style={{ marginTop: spacing.sm }} />
        </View>
      ) : shop.data ? (
        <>
          <View style={styles.identity}>
            <Text style={styles.shopName}>{shop.data.business_name}</Text>
            <View style={styles.metaRow}>
              {shop.data.rating !== null && (
                <>
                  <Star size={13} color="#f5a623" fill="#f5a623" strokeWidth={0} />
                  <Text style={styles.metaStrong}>{shop.data.rating}</Text>
                  <Text style={styles.metaDim}>({shop.data.reviews_count} ratings)</Text>
                </>
              )}
              {shop.data.distance_km != null && (
                <>
                  <Text style={styles.metaDot}>·</Text>
                  <MapPin size={12} color={c.gray[500]} strokeWidth={2.2} />
                  <Text style={styles.metaDim}>{formatDistance(shop.data.distance_km)}</Text>
                </>
              )}
              <Text style={styles.metaDot}>·</Text>
              <Text style={closed ? styles.closedText : styles.openText}>{closed ? "Closed" : "Open now"}</Text>
            </View>
          </View>

          {/* Fulfillment — only the modes this business offers */}
          <View style={styles.toggleWrap}>
            {hasDelivery && hasPickup ? (
              <View style={styles.toggle}>
                <Pressable
                  style={[styles.toggleBtn, fulfillment === "delivery" && styles.toggleOn]}
                  onPress={() => setFulfillment("delivery")}
                >
                  <Text style={[styles.toggleText, fulfillment === "delivery" && styles.toggleTextOn]}>Delivery</Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleBtn, fulfillment === "pickup" && styles.toggleOn]}
                  onPress={() => setFulfillment("pickup")}
                >
                  <Text style={[styles.toggleText, fulfillment === "pickup" && styles.toggleTextOn]}>Pick-up</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.modePill}>
                <Text style={styles.modePillText}>{hasDelivery ? "🚚 Delivery only" : "🏬 Pickup only"}</Text>
              </View>
            )}
          </View>

          {/* Info card */}
          <View style={styles.infoCard}>
            {fulfillment === "delivery" && hasDelivery ? (
              <>
                <View style={styles.infoRow}>
                  <Bike size={16} color={c.brand[600]} strokeWidth={2.2} />
                  <Text style={styles.infoText}>
                    {prep !== null ? `Delivery ${prep}–${prep + 20} min  ·  ` : "Delivery  ·  "}
                    {Number(shop.data.delivery_fee) > 0 ? `${money(shop.data.delivery_fee ?? 0)} fee` : "Free delivery"}
                  </Text>
                </View>
                {shop.data.delivery_radius_km != null && (
                  <View style={styles.infoRow}>
                    <MapPin size={16} color={c.gray[400]} strokeWidth={2.2} />
                    <Text style={styles.infoDim}>Delivers within {shop.data.delivery_radius_km} km</Text>
                  </View>
                )}
                {shop.data.min_order_amount != null && (
                  <View style={styles.infoRow}>
                    <ShoppingBag size={16} color={c.gray[400]} strokeWidth={2.2} />
                    <Text style={styles.infoDim}>Min. order {money(shop.data.min_order_amount)}</Text>
                  </View>
                )}
                {shop.data.free_delivery_threshold != null && (
                  <View style={styles.infoRow}>
                    <Bike size={16} color={c.brand[400]} strokeWidth={2.2} />
                    <Text style={styles.infoText}>Free delivery above {money(shop.data.free_delivery_threshold)}</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.infoRow}>
                <ShoppingBag size={16} color={c.brand[600]} strokeWidth={2.2} />
                <Text style={styles.infoText}>
                  {prep !== null ? `Pick-up · ready in ~${prep} min` : "Pick-up · collect from the shop"}
                </Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Clock size={16} color={c.gray[400]} strokeWidth={2.2} />
              <Text style={styles.infoDim}>Cash on delivery</Text>
            </View>
          </View>

          {closed && (
            <View style={styles.warnStrip}>
              <Text style={styles.warnText}>This shop is closed right now — browse the menu, order later.</Text>
            </View>
          )}
          {fulfillment === "delivery" && shop.data.delivers_to_me === false && (
            <View style={styles.warnStrip}>
              <Text style={styles.warnText}>Your location is outside this shop's delivery range — try Pick-up.</Text>
            </View>
          )}
        </>
      ) : (
        <View style={styles.identity}>
          <Text style={styles.metaDim}>This shop isn't available right now.</Text>
        </View>
      )}

      {/* Menu search */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Search size={17} color={c.gray[400]} strokeWidth={2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search menu…"
            placeholderTextColor={c.gray[400]}
            autoCapitalize="none"
            style={styles.searchInput}
          />
        </View>
      </View>

      {/* Category chips */}
      {(shop.data?.categories?.length ?? 0) > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
          <CatChip label="All" active={catId === ""} onPress={() => setCatId("")} />
          {shop.data!.categories!.map((cat) => (
            <CatChip key={cat.id} label={cat.name} active={catId === cat.id} onPress={() => setCatId(cat.id)} />
          ))}
        </ScrollView>
      )}
    </>
  );

  return (
    <SafeScreen backgroundColor={c.bg}>
      <FocusedStatusBar style="dark-content" background={c.bg} />
      <FlatList
        data={products.isLoading ? [] : rows}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        contentContainerStyle={[styles.list, cartCount > 0 && { paddingBottom: 96 }]}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        renderItem={({ item }) => {
          const img = item.images[0];
          const unavailable = item.type === "product" && (!item.in_stock || !item.available_now);
          return (
            <View style={[styles.productCard, unavailable && styles.productOff]}>
              <View style={styles.productThumb}>
                {img ? (
                  <Image source={{ uri: img }} style={styles.productImg} resizeMode="cover" />
                ) : (
                  <Text style={styles.productInitial}>{item.name.charAt(0)}</Text>
                )}
              </View>
              <View style={styles.productInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
                  {/*
                    Said BEFORE the tap. A refusal after a basket is built is a
                    rule discovered at the worst moment; a badge is the same
                    rule, stated where the decision is made.
                  */}
                  {item.requires_prescription && (
                    <View style={styles.rxBadge}>
                      <Text style={styles.rxText}>Rx</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.productMeta} numberOfLines={1}>
                  {item.category?.name ?? ""}
                  {item.type === "service" && item.duration_minutes ? ` · ${item.duration_minutes} min` : ""}
                  {item.variants.length > 0 ? ` · ${item.variants.length} options` : ""}
                  {item.modifier_groups.length > 0 ? " · customizable" : ""}
                </Text>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>
                    {money(item.price)}
                    {item.sold_by === "weight" && item.unit ? <Text style={styles.perUnit}>/{item.unit}</Text> : null}
                  </Text>
                  {item.original_price != null && <Text style={styles.strike}>{money(item.original_price)}</Text>}
                </View>
                {!item.available_now && item.in_stock && <Text style={styles.offText}>Not available right now</Text>}
                {!item.in_stock && item.type === "product" && <Text style={styles.offText}>Out of stock</Text>}
              </View>
              {item.type === "product" ? (
                acceptsOrders && !unavailable ? (
                  <AddButton size={34} label={item.name} onPress={() => onAdd(item)} />
                ) : canReserve && item.in_stock ? (
                  <Pressable style={styles.reserveBtn} onPress={() => askReserve(item.id, item.name)} disabled={reserve.isPending}>
                    <Text style={styles.reserveText}>Reserve</Text>
                  </Pressable>
                ) : null
              ) : (
                <Pressable style={styles.reserveBtn} onPress={contactShop}>
                  <Text style={styles.reserveText}>Contact</Text>
                </Pressable>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          products.isLoading ? (
            <View style={styles.skeletons}>
              <SkeletonMenuRow />
              <SkeletonMenuRow />
              <SkeletonMenuRow />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {debounced ? "Nothing matches your search" : "Nothing listed yet"}
              </Text>
            </View>
          )
        }
      />

      {/*
        Sticky cart bar → THE CART.

        It went straight to Checkout, which meant the basket screen was not in
        the flow at all: the only way to reach it was to notice the tab. So the
        one screen where you check what you are buying, change a quantity or
        drop a line was skipped on the way to the screen that asks for your
        address — and "View cart" was the label on the button that did it.
      */}
      {cartCount > 0 && (
        <Pressable
          style={[styles.cartBar, { bottom: insets.bottom + spacing.md }]}
          accessibilityRole="button"
          onPress={() => navigation.navigate("Tabs", { screen: "CartTab" })}
        >
          <View style={styles.cartCount}>
            <Text style={styles.cartCountText}>{cartCount}</Text>
          </View>
          <Text style={styles.cartBarText}>View cart · {money(cart.subtotal())}</Text>
          {/*
            A drawn arrow in its own disc, not the character "→".
            
            A text arrow takes the font's weight and the font's optical size,
            which on this bar came out thin and small beside a bold label — it
            read as punctuation rather than as the thing you press. The disc
            gives it a hit target and says the bar goes somewhere.
          */}
          <View style={styles.cartBarCta}>
            <ArrowRight size={18} color={c.primary} strokeWidth={2.6} />
          </View>
        </Pressable>
      )}

      {/* Configurator sheet */}
      {sheetProduct && (
        <ProductSheet product={sheetProduct} onClose={() => setSheetProduct(null)} onAdd={onConfigured} />
      )}
    </SafeScreen>
  );
}

function CatChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable style={[styles.cat, active && styles.catOn]} onPress={onPress}>
      <Text style={[styles.catText, active && styles.catTextOn]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  list: { paddingBottom: spacing.xxl },

  // Hero
  hero: { height: 168, backgroundColor: c.brand[100] },
  heroImg: { width: "100%", height: "100%" },
  heroFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  heroInitial: { fontSize: 72, fontWeight: "800", letterSpacing: -2 },
  heroBar: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroRight: { flexDirection: "row", gap: spacing.xs },
  round: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // Identity
  identity: { alignItems: "center", paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: 5 },
  shopName: { ...typography.title, color: c.text, fontSize: 22, textAlign: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaStrong: { ...typography.label, color: c.text, fontSize: 13 },
  metaDim: { ...typography.small, color: c.gray[500], fontSize: 13 },
  metaDot: { color: c.gray[300], paddingHorizontal: 2 },
  openText: { ...typography.label, color: c.brand[600], fontSize: 13 },
  closedText: { ...typography.label, color: c.error, fontSize: 13 },

  // Toggle
  toggleWrap: { alignItems: "center", marginTop: spacing.sm },
  toggle: {
    flexDirection: "row",
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.full,
    padding: 3,
  },
  toggleBtn: { paddingHorizontal: spacing.lg, paddingVertical: 7, borderRadius: radius.full },
  toggleOn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.brand[500] },
  toggleText: { ...typography.label, color: c.gray[500], fontSize: 13 },
  toggleTextOn: { color: c.brand[700] },
  modePill: {
    backgroundColor: c.brand[50],
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  modePillText: { ...typography.label, color: c.brand[700], fontSize: 13 },

  // Info card
  infoCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoText: { ...typography.label, color: c.text, fontSize: 13.5 },
  infoDim: { ...typography.small, color: c.gray[500], fontSize: 13 },

  warnStrip: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    backgroundColor: c.warningBg,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  warnText: { ...typography.tiny, color: c.warning },

  // Search + cats
  searchWrap: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchInput: { flex: 1, ...typography.body, color: c.text, padding: 0 },
  cats: { paddingHorizontal: spacing.md, gap: spacing.xs, paddingVertical: spacing.sm },
  cat: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  catOn: { backgroundColor: c.brand[500], borderColor: c.brand[500] },
  catText: { ...typography.small, color: c.gray[600], fontSize: 13 },
  catTextOn: { color: c.white, fontWeight: "700" },

  // Products
  skeletons: { padding: spacing.md, gap: spacing.sm },
  productCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  productOff: { opacity: 0.55 },
  productThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  productImg: { width: "100%", height: "100%" },
  productInitial: { ...typography.title, color: c.gray[300] },
  productInfo: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rxBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: c.infoBg,
  },
  rxText: { ...typography.tiny, color: c.info, fontWeight: "800", fontSize: 10 },
  productName: { ...typography.label, color: c.text, fontSize: 15 },
  productMeta: { ...typography.tiny, color: c.gray[500] },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  price: { ...typography.label, color: c.brand[600], fontSize: 14.5 },
  perUnit: { ...typography.tiny, color: c.gray[400] },
  strike: { ...typography.tiny, color: c.gray[400], textDecorationLine: "line-through" },
  offText: { ...typography.tiny, color: c.error },
  reserveBtn: {
    borderWidth: 1,
    borderColor: c.brand[500],
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  reserveText: { ...typography.tiny, color: c.brand[700], fontWeight: "700" },

  empty: { alignItems: "center", paddingVertical: spacing.xxl },
  emptyTitle: { ...typography.body, color: c.gray[500] },

  // Cart bar
  /**
   * `bottom` is set at the call site, from the safe-area inset.
   *
   * An absolutely-positioned child does NOT sit inside its parent's
   * paddingBottom — Yoga measures `bottom` from the border box — so
   * `SafeScreen`'s inset, which correctly holds the LIST clear of the
   * navigation bar, does nothing for this bar. On a phone with three-button
   * navigation it sat underneath the buttons, with "View cart · Rs 3,980"
   * showing through them.
   */
  cartBar: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.brand[500],
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    height: 52,
  },
  cartCount: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  cartCountText: { ...typography.tiny, color: c.white, fontWeight: "800" },
  cartBarText: { ...typography.label, color: c.white, flex: 1, textAlign: "center", fontSize: 15 },
  cartBarCta: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    // On the brand-filled bar, so it takes the token for things sitting ON the
    // brand — not the white literal, which would follow neither theme.
    backgroundColor: c.onPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
});
