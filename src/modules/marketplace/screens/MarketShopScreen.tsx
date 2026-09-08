import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BagIcon,
  ClockIcon,
  HeartIcon,
  MapPinIcon,
  MotorcycleIcon,
  PhoneIcon,
  SearchIcon,
  StarIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { EmptyState } from "../../../common/ui/EmptyState";
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
import { shopInitial, useShopCover } from "../shopCover";
import { SmartImage } from "../../../common/ui/SmartImage";
import { toast } from "../../../common/ui/toast";
import { confirm } from "../../../common/ui/confirm";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { money } from "../../../common/format";
import { OfferBadge, Price } from "../../../common/ui/Price";
import {
  useFavorites,
  useMarketProduct,
  useMarketShop,
  useShopMenu,
  useReserve,
  useToggleFavorite,
} from "../hooks/useMarketplace";


type Params = { MarketShop: { slug: string; productId?: string } };

/**
 * Shop page, foodpanda-style: hero image → name + rating → Delivery/Pick-up
 * toggle → delivery info card → menu search → category chips → products.
 */
/**
 * A row of the menu: a category heading, or one thing to buy.
 *
 * The headings are ROWS rather than section objects because a chip has to be
 * able to say "scroll to row fourteen", and `SectionList`'s `scrollToLocation`
 * takes a section index and an item within it — two numbers to keep in step
 * with a list that is still growing as the rest of the menu arrives.
 */
type MenuRow =
  /**
   * The contents bar, AS A ROW.
   *
   * It used to sit outside the list, permanently above it. Reported as: the
   * tabs are at the very top, put them under the shop and let them stick when
   * you scroll to them.
   *
   * A row is how it gets both. It scrolls with the shop's own header until it
   * reaches the top, and a second copy — see `pinned` — takes over from there.
   * What it is emphatically NOT is `stickyHeaderIndices`, which re-parents a
   * virtualised row and crashed this screen twice.
   */
  | { kind: "cats"; key: string }
  | { kind: "heading"; key: string; name: string }
  | { kind: "product"; key: string; product: PublicProduct };

/**
 * How tall the pinned bar is, so a jump lands BELOW it rather than under it.
 *
 * `scrollToIndex` puts a row at the very top of the viewport, and the top of
 * the viewport is where the sticky bar is — so without this offset every jump
 * hid the heading it had just been asked to go to.
 */
const CHIP_BAR = 54; // 10 + (7 + 18 + 7 + 2 border) + 10

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
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");

  const [sheetProduct, setSheetProduct] = useState<PublicProduct | null>(null);

  const shop = useMarketShop(slug, { lat: lat ?? undefined, lng: lng ?? undefined });
  const products = useShopMenu(slug, debounced || undefined);
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
  const rows = React.useMemo(
    () => (products.data?.pages ?? []).flatMap((page) => page.data as PublicProduct[]),
    [products.data],
  );

  /**
   * THE MENU AS SECTIONS, and the index of each heading.
   *
   * One flat array because `FlatList` takes one, and the headings ride in it
   * as rows of their own — which is also what makes `scrollToIndex` possible:
   * a chip knows the row number of its own heading, so pressing it is a jump
   * rather than a request.
   *
   * The server orders by category already, so this only has to notice where
   * one ends and the next begins. Doing the GROUPING here as well would be a
   * second opinion about the order, formed with less information.
   */
  const { menu, jumps } = React.useMemo(() => {
    const out: MenuRow[] = [];
    const at = new Map<string, number>();
    let last: string | null = null;

    for (const p of rows) {
      const name = p.category?.name ?? "More";
      if (name !== last) {
        at.set(name, out.length);
        out.push({ kind: "heading", key: `h:${name}`, name });
        last = name;
      }
      out.push({ kind: "product", key: p.id, product: p });
    }

    /**
     * The bar goes in FRONT, and every jump index moves by one.
     *
     * Unshifting after the map is built is the bug waiting to happen here —
     * every recorded index would be one short and every chip would land on the
     * last product of the previous category. So the map is rebuilt, not
     * patched.
     *
     * Only when there is more than one category: a shop with a single section
     * has nothing to jump between, and a bar with one chip is furniture.
     */
    if (at.size > 1) {
      out.unshift({ kind: "cats", key: "cats" });

      return {
        menu: out,
        jumps: new Map([...at].map(([name, i]) => [name, i + 1])),
      };
    }

    return { menu: out, jumps: at };
  }, [rows]);

  /** Which section the top of the list is in, for the chip that lights up. */
  const [section, setSection] = React.useState<string | null>(null);
  const listRef = React.useRef<FlatList<MenuRow>>(null);

  /**
   * ── STICKY, WITHOUT THE TWO THINGS THAT CRASHED ──────────────────
   *
   * The bar is drawn TWICE: once as a row in the list, which scrolls away
   * under the shop's header, and once absolutely positioned at the top, which
   * appears at the moment the row would have left the screen.
   *
   * Two elements rather than one moved element, because both of the ways of
   * moving one element broke this screen on a real device:
   *
   *   `stickyHeaderIndices`   re-parents the row into a wrapper of its own,
   *                           and doing that inside a VIRTUALISED list is two
   *                           trees disagreeing about one view.
   *
   *   `Animated.event` +      `VirtualizedList` needs the JS scroll events to
   *   native driver           decide which cells to keep. The native driver
   *                           takes them away and the render window goes
   *                           stale while the native tree keeps moving.
   *
   * So the listener below is a PLAIN JS one, and it is careful about what it
   * does with what it hears: `setState` only when the boolean actually flips.
   * A `setState` per scroll frame is the jank this screen was reported for.
   */
  const [pinned, setPinned] = React.useState(false);
  const pinnedRef = React.useRef(false);

  /**
   * THE THRESHOLD IS THE HEADER'S HEIGHT, NOT THE ROW'S POSITION.
   *
   * The obvious version of this measured the cats row with `onLayout` and read
   * `layout.y`. That is always 0: `FlatList` wraps every `renderItem` result
   * in a cell container of its own, so a row's layout is relative to that
   * wrapper and not to the content. The pin condition would have been
   * `offset >= 0` — or, with a guard against zero, a bar that never appeared
   * at all and nothing to say why.
   *
   * `layout.height` on the header IS reliable, and the cats row sits
   * immediately after it, so the header's height is exactly the offset at
   * which the row reaches the top. One number, measured once, from the element
   * that owns it.
   */
  const headerH = React.useRef(0);
  const onHeaderLayout = React.useCallback((e: LayoutChangeEvent) => {
    headerH.current = e.nativeEvent.layout.height;
  }, []);

  const onScroll = React.useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Before the header has been laid out there is no threshold to cross, and
    // guessing one puts a bar over the shop's own name on first paint.
    if (headerH.current <= 0) return;

    const should = e.nativeEvent.contentOffset.y >= headerH.current;
    if (should === pinnedRef.current) return;

    pinnedRef.current = should;
    setPinned(should);
  }, []);

  const jumpTo = (name: string) => {
    const index = jumps.get(name);
    if (index == null) return;
    setSection(name);
    // `viewPosition: 0` puts the heading at the top rather than centring it,
    // which is what "go to Burgers" means — and `viewOffset` keeps it clear of
    // the bar that sits above the list.
    listRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0,
      viewOffset: CHIP_BAR,
    });
  };

  /**
   * A heading is a row, so the topmost VISIBLE heading is the section.
   *
   * `viewabilityConfig` has to be a stable object — a fresh one each render
   * makes FlatList throw "Changing viewabilityConfig on the fly is not
   * supported", which is the kind of crash that only happens on a device.
   */
  const viewability = React.useRef({ itemVisiblePercentThreshold: 10 }).current;
  const onViewable = React.useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: MenuRow }> }) => {
      const head = viewableItems.find((v) => v.item.kind === "heading");
      if (head != null && head.item.kind === "heading") setSection(head.item.name);
    },
  ).current;

  /**
   * HOW THE CONTENTS BAR STAYS ON SCREEN.
   *
   * ── Two crashes taught this ──────────────────────────────────────
   *
   *     addViewAt: failed to insert view [3320] into parent [2750] at index 50
   *     index=50 count=1        SurfaceMountingManager.kt:389
   *
   * A Fabric mount mismatch: React asking the native tree to put a child at
   * index 50 of a parent holding one. Twice, on this screen, from two
   * different attempts at making a bar stay put.
   *
   *   `stickyHeaderIndices`   re-parents the sticky row into a wrapper of its
   *                           own — and doing that to a row inside a
   *                           VIRTUALISED list, whose cells mount and unmount
   *                           beneath it, is two trees disagreeing about one
   *                           view. Worse here, because that row changed TYPE
   *                           between renders.
   *
   *   `Animated.event` on     `VirtualizedList` needs the JS scroll events to
   *   a plain FlatList        decide which cells to keep rendered. Attaching
   *                           the native driver to `onScroll` takes them away,
   *                           and the render window goes stale while the
   *                           native tree keeps moving.
   *
   * So: NEITHER. The bar is one element, outside the list, always there. No
   * re-parenting, no scroll listener, nothing to fall out of step. A contents
   * page that is permanently reachable is also simply better than one that
   * has to be scrolled into existence — which is what "sticky" was for.
   */

  /**
   * RESERVING NEEDS AN ACCOUNT. A BASKET DOES NOT.
   *
   * ── The bug ──────────────────────────────────────────────────────
   *
   * `acceptsOrders` was `isCustomer && …`, and `isCustomer` is
   * `user?.role === "customer"` — false for a guest. So a signed-out visitor
   * got NO add button anywhere on a shop page: not disabled, not explained,
   * simply absent, on the screen the whole app funnels into.
   *
   * The aisle never had that gate, so the app disagreed with itself — you
   * could fill a basket from Browse and not from the shop the items belong to.
   *
   * ── Why the basket is open and the reservation is not ────────────
   *
   * The basket is a list on this phone. Nothing is sent, nothing is held, and
   * nobody's stock is touched — so there is nothing to sign in FOR until
   * checkout, which asks properly and keeps the basket while it does.
   *
   * A reservation is the opposite: it hits the server the moment it is
   * pressed and holds an item against somebody's name. That needs a name.
   *
   * `isCustomer` is not doing double duty here either — a business account
   * signed into this app never reaches this screen; the navigator sends them
   * to `BusinessAccount` first.
   */
  const canReserve = isCustomer && (shop.data?.features?.reservations ?? false);
  const acceptsOrders = shop.data?.accepts_orders ?? false;
  const hasDelivery = shop.data?.fulfillment?.delivery ?? shop.data?.features?.delivery ?? true;
  const hasPickup = shop.data?.fulfillment?.pickup ?? true;
  const closed = shop.data?.is_open_now === false;
  const cartCount = cart.shopSlug === slug ? cart.count() : 0;

  /**
   * Memoised, because a fresh ARRAY is a fresh prop.
   *
   * `contentContainerStyle={[a, b, cond && {…}]}` builds a new array every
   * render, and an inline object inside it a new object — so the list saw its
   * own container style change on every section change and re-laid out.
   */
  const listStyle = React.useMemo(
    () => [styles.list, styles.grow, cartCount > 0 ? styles.listWithCart : null],
    [styles, cartCount],
  );

  const coverFor = useShopCover();
  const cover = coverFor(slug);
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
      image: p.images[0] ?? null,
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
        image: p.images[0] ?? null,
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

  /**
   * MEMOISED, because a fresh element remounts the whole subtree.
   *
   * `const header = (…)` in the component body is a new React element on
   * every render, and `ListHeaderComponent` takes it at face value: the hero,
   * the shop's identity, the search box and two horizontal scrollers are torn
   * down and rebuilt each time. Ordinarily that is only waste. While the menu
   * is arriving — a page at a time, each append a render — it is a subtree
   * being remounted repeatedly underneath a native list that is trying to
   * keep its own children in step.
   */
  const header = React.useMemo(
    () => (
    <>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        {/*
          The SAME derived cover as the card this shop was tapped from, so
          opening a shop does not change what it looks like. It used to be a
          brand-red block with a translucent white letter on it — the same
          block for every shop, and a letter at 85% opacity that read as a
          watermark rather than as the shop's mark.

          A `SmartImage` rather than a bare `<Image>`, which is the difference
          between a hero that shimmers and then fades in, and one that is a
          motionless coloured block for two seconds and then, suddenly, a
          photograph. This is the biggest picture in the app; it is the one
          worth getting right. It also gains the thing a bare Image has never
          had here — an answer for a URL that 404s.
        */}
        <SmartImage
          uri={hero ?? null}
          fallback={shopInitial(shop.data?.business_name)}
          fallbackBackground={cover.bg}
          fallbackColor={cover.fg}
          style={styles.heroImg}
        />
        <View style={styles.heroBar}>
          <Pressable style={styles.round} onPress={() => navigation.goBack()} hitSlop={8}>
            <ArrowLeftIcon size={20} color={c.text} />
          </Pressable>
          <View style={styles.heroRight}>
            <Pressable style={styles.round} onPress={contactShop} hitSlop={8}>
              <PhoneIcon size={18} color={c.text} />
            </Pressable>
            {isCustomer && (
              <Pressable
                style={styles.round}
                onPress={() => toggleFavorite.mutate(slug)}
                disabled={toggleFavorite.isPending}
                hitSlop={8}
              >
                <HeartIcon
                  size={19}
                  color={isFavorite ? c.error : c.text}
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
                  <StarIcon size={13} color={c.warm} />
                  <Text style={styles.metaStrong}>{shop.data.rating}</Text>
                  <Text style={styles.metaDim}>({shop.data.reviews_count} ratings)</Text>
                </>
              )}
              {shop.data.distance_km != null && (
                <>
                  <Text style={styles.metaDot}>·</Text>
                  <MapPinIcon size={12} color={c.gray[500]} />
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
                  <MotorcycleIcon size={16} color={c.brand[600]} />
                  <Text style={styles.infoText}>
                    {prep !== null ? `Delivery ${prep}–${prep + 20} min  ·  ` : "Delivery  ·  "}
                    {Number(shop.data.delivery_fee) > 0 ? `${money(shop.data.delivery_fee ?? 0)} fee` : "Free delivery"}
                  </Text>
                </View>
                {shop.data.delivery_radius_km != null && (
                  <View style={styles.infoRow}>
                    <MapPinIcon size={16} color={c.gray[400]} />
                    <Text style={styles.infoDim}>Delivers within {shop.data.delivery_radius_km} km</Text>
                  </View>
                )}
                {shop.data.min_order_amount != null && (
                  <View style={styles.infoRow}>
                    <BagIcon size={16} color={c.gray[400]} />
                    <Text style={styles.infoDim}>Min. order {money(shop.data.min_order_amount)}</Text>
                  </View>
                )}
                {shop.data.free_delivery_threshold != null && (
                  <View style={styles.infoRow}>
                    <MotorcycleIcon size={16} color={c.brand[400]} />
                    <Text style={styles.infoText}>Free delivery above {money(shop.data.free_delivery_threshold)}</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.infoRow}>
                <BagIcon size={16} color={c.brand[600]} />
                <Text style={styles.infoText}>
                  {prep !== null ? `Pick-up · ready in ~${prep} min` : "Pick-up · collect from the shop"}
                </Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <ClockIcon size={16} color={c.gray[400]} />
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
          <SearchIcon size={17} color={c.gray[400]} />
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

    </>
    ),
    // Everything the header READS. Listed rather than left to a lint rule,
    // because a missing entry here is a header that stops updating — a shop
    // whose rating never appears, a toggle that will not move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // NOT `section` or `jumps`. The contents bar left the header — and
    // `section` changes on every scroll, so listing it here would rebuild the
    // whole header while a finger is moving, which is the remount this memo
    // exists to stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      shop.data, shop.isLoading, styles, c, cover, favorites.data, isFavorite,
      fulfillment, search, hasDelivery, hasPickup, closed, prep, hero, isCustomer,
      slug, navigation, contactShop, toggleFavorite,
    ],
  );

  /**
   * The header, wrapped in the thing that measures it.
   *
   * Separate from `header` so the expensive memo keeps its own dependency
   * list: this one only rebuilds when that element does, and `onHeaderLayout`
   * has `[]` deps so it never causes a rebuild by itself.
   */
  const measuredHeader = React.useMemo(
    () => <View onLayout={onHeaderLayout}>{header}</View>,
    [header, onHeaderLayout],
  );

  /**
   * ── WHY THE ROWS MOVED OUT OF `renderItem` ────────────────────────
   *
   * "Shop detail screen py lag araha scroll krty."
   *
   * `renderItem` was an arrow function written inline in this component, so
   * it was a NEW function on every render — and `section` is state that
   * changes while a finger is moving, because the contents chip that lights up
   * follows the topmost visible heading.
   *
   * So every scroll that crossed a category boundary re-rendered every product
   * row on the screen. `removeClippedSubviews` is off here (it caused a Fabric
   * mount crash twice — see the note above), which means NOTHING is unmounted:
   * the whole menu was being rebuilt mid-gesture.
   *
   * `React.memo` on the row plus a stable `renderItem` breaks that chain: a
   * section change now repaints the chips and nothing else.
   */
  const renderRow = React.useCallback(
    ({ item: row }: { item: MenuRow }) => {
      if (row.kind === "cats") {
        return (
          <View style={styles.catsFlow}>
            <CatBar names={[...jumps.keys()]} active={section} onPick={jumpTo} />
          </View>
        );
      }
      if (row.kind === "heading") {
        return <Text style={styles.section}>{row.name}</Text>;
      }
      return (
        <ProductRow
          item={row.product}
          styles={styles}
          cover={coverFor(row.product.id)}
          acceptsOrders={acceptsOrders}
          canReserve={canReserve}
          reserving={reserve.isPending}
          onAdd={onAdd}
          onReserve={askReserve}
          onContact={contactShop}
        />
      );
    },
    // `section` and `jumps` are here ON PURPOSE — the cats row reads them.
    // The rows do not: `ProductRow` is memoised, so a new `renderRow` costs a
    // shallow prop compare per row rather than a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [styles, jumps, section, acceptsOrders, canReserve, reserve.isPending, coverFor, onAdd, askReserve, contactShop],
  );

  return (
    <SafeScreen backgroundColor={c.bg}>
      <FocusedStatusBar style="dark-content" background={c.bg} />
      {/*
        THE PINNED COPY. Absolutely positioned, and only while the row it
        stands in for is off the top of the screen — see `pinned`.

        `pointerEvents` is left alone deliberately: while it is up it IS the
        bar, and it has to take the taps.
      */}
      {jumps.size > 1 && pinned && (
        <View style={[styles.catsBar, styles.catsPinned]}>
          <CatBar names={[...jumps.keys()]} active={section} onPick={jumpTo} />
        </View>
      )}

      <FlatList
        ref={listRef}
        data={products.isLoading ? [] : menu}
        keyExtractor={(row) => row.key}
        ListHeaderComponent={measuredHeader}
        /*
          OFF, on purpose.

          Android's default for a virtualized list is to DETACH the native
          views of rows that scroll out of the window rather than merely stop
          updating them. It is a memory win, and on Fabric it is also the
          shortest path to the native tree and the shadow tree disagreeing
          about how many children a container has — which is the crash this
          screen has now produced twice:

              addViewAt: failed to insert view … index=50 count=1

          This list is bounded: one shop's menu, ordered by category. It is
          not the marketplace aisle. Keeping the rows mounted costs a little
          memory and removes an entire class of mount mismatch.
        */
        removeClippedSubviews={false}
        contentContainerStyle={listStyle}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        /*
          ── SMOOTHNESS ────────────────────────────────────────────────
          A plain JS listener, 16ms — see `onScroll`. It must stay JS: the
          native driver starves `VirtualizedList` of the events it needs.
        */
        onScroll={onScroll}
        scrollEventThrottle={16}
        /*
          `removeClippedSubviews` is off, so every row that has ever been
          rendered stays mounted. That makes the FIRST batch the thing worth
          keeping small: the menu arrives ordered, and nobody has scrolled yet.
        */
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        /*
          Between batches, not during the gesture. The default 50ms lands work
          in the middle of a flick, which on this screen is when a category
          boundary is being crossed and the chips are repainting.
        */
        updateCellsBatchingPeriod={80}
        /*
          A JUMP INTO A LIST NOBODY HAS SCROLLED YET.

          `scrollToIndex` on a list of variable-height rows can land short,
          because FlatList only knows the heights of what it has measured.
          Without this handler that is an exception, not a near miss — so it
          scrolls as far as it can, waits a frame for the rows in between to
          measure, and finishes the jump.
        */
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          });
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
              viewPosition: 0,
              viewOffset: CHIP_BAR,
            });
          }, 120);
        }}
        renderItem={renderRow}
        ListEmptyComponent={
          products.isLoading ? (
            <View style={styles.skeletons}>
              <SkeletonMenuRow />
              <SkeletonMenuRow />
              <SkeletonMenuRow />
            </View>
          ) : (
            <EmptyState
              icon={BagIcon}
              tone={debounced ? "muted" : "warm"}
              title={debounced ? `Nothing matches “${debounced}”` : "Nothing listed yet"}
              message={
                debounced
                  ? "Try a shorter word — the menu is searched by name and brand."
                  : "This shop has not put anything on its menu yet."
              }
            />
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
            <ArrowRightIcon size={18} color={c.primary} />
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

/**
 * ONE PRODUCT, MEMOISED.
 *
 * ── The lag this exists for ─────────────────────────────────────────
 *
 * "Shop detail screen py lag araha scroll krty."
 *
 * This markup was inline in `renderItem`, which was an arrow function in the
 * screen body — a new function on every render. And `section` is state that
 * changes WHILE A FINGER IS MOVING, because the chip that lights up follows
 * the topmost visible heading.
 *
 * `removeClippedSubviews` is off on this list (it caused a Fabric mount crash
 * twice), so nothing is ever unmounted. Every category boundary crossed while
 * scrolling was rebuilding the entire menu.
 *
 * ── Why props and not hooks ─────────────────────────────────────────
 *
 * `styles` and the two permission flags are passed IN. Calling `useColors()`
 * here would make every row a context subscriber, and a theme change would
 * re-render all of them individually rather than once through the parent —
 * the same cost this component removes, spent somewhere less visible.
 */
const ProductRow = React.memo(function ProductRow({
  item,
  styles,
  cover,
  acceptsOrders,
  canReserve,
  reserving,
  onAdd,
  onReserve,
  onContact,
}: {
  item: PublicProduct;
  styles: ReturnType<typeof makeStyles>;
  cover: { bg: string; fg: string };
  acceptsOrders: boolean;
  canReserve: boolean;
  reserving: boolean;
  onAdd: (p: PublicProduct) => void;
  onReserve: (id: string, name: string) => void;
  onContact: () => void;
}) {
  const img = item.images[0];
  const unavailable = item.type === "product" && (!item.in_stock || !item.available_now);

  return (
    <View style={[styles.productCard, unavailable && styles.productOff]}>
      <View style={styles.productThumb}>
        <SmartImage
          uri={img ?? null}
          fallback={shopInitial(item.name)}
          fallbackBackground={cover.bg}
          fallbackColor={cover.fg}
          style={styles.productImg}
        />
      </View>
      <View style={styles.productInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
          {/*
            Said BEFORE the tap. A refusal after a basket is built is a rule
            discovered at the worst moment; a badge is the same rule, stated
            where the decision is made.
          */}
          {item.requires_prescription && (
            <View style={styles.rxBadge}>
              <Text style={styles.rxText}>Rx</Text>
            </View>
          )}
        </View>
        <Text style={styles.productMeta} numberOfLines={1}>
          {item.category?.name ?? ""}
          {item.type === "service" && item.duration_minutes ? ` \u00b7 ${item.duration_minutes} min` : ""}
          {item.variants.length > 0 ? ` \u00b7 ${item.variants.length} options` : ""}
          {item.modifier_groups.length > 0 ? " \u00b7 customizable" : ""}
        </Text>
        <View style={styles.priceRow}>
          <Price value={item.price} was={item.original_price} size="md" />
          {item.sold_by === "weight" && item.unit ? (
            <Text style={styles.perUnit}>/{item.unit}</Text>
          ) : null}
          <OfferBadge value={item.price} was={item.original_price} />
        </View>
        {!item.available_now && item.in_stock && <Text style={styles.offText}>Not available right now</Text>}
        {!item.in_stock && item.type === "product" && <Text style={styles.offText}>Out of stock</Text>}
      </View>
      {item.type === "product" ? (
        acceptsOrders && !unavailable ? (
          <AddButton size={34} label={item.name} onPress={() => onAdd(item)} />
        ) : canReserve && item.in_stock ? (
          <Pressable
            style={styles.reserveBtn}
            onPress={() => onReserve(item.id, item.name)}
            disabled={reserving}
          >
            <Text style={styles.reserveText}>Reserve</Text>
          </Pressable>
        ) : null
      ) : (
        <Pressable style={styles.reserveBtn} onPress={onContact}>
          <Text style={styles.reserveText}>Contact</Text>
        </Pressable>
      )}
    </View>
  );
});

/**
 * THE CONTENTS BAR. One component, rendered in two places.
 *
 * As a ROW in the list, and again pinned above it — see the comment on
 * `pinned` for why it is drawn twice rather than made sticky. Two elements
 * with one piece of state between them: both read `active` and both call the
 * same `onPick`, so there is no second opinion about which section is open.
 */
function CatBar({
  names,
  active,
  onPick,
}: {
  names: string[];
  active: string | null;
  onPick: (name: string) => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
      {names.map((name) => (
        <CatChip key={name} label={name} active={active === name} onPress={() => onPick(name)} />
      ))}
    </ScrollView>
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
  /** So `ListEmptyComponent` has a screen to centre in. */
  grow: { flexGrow: 1 },
  /**
   * The pinned bar's own surface.
   *
   * Opaque, and with a rule under it. A sticky row inherits nothing from the
   * page — the menu scrolls UNDERNEATH it — so a transparent bar shows every
   * product row sliding through the chips.
   */
  catsBar: {
    backgroundColor: c.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  /**
   * The copy that lives IN the list, scrolling with the shop's header.
   *
   * Same fill and rule as the pinned one so the hand-off is invisible: what
   * gives a two-element sticky away is the two elements not matching.
   */
  catsFlow: {
    backgroundColor: c.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  /** Room for the floating cart bar, as a named style rather than an inline
   *  object — see `listStyle`. */
  listWithCart: { paddingBottom: 96 },
  // A shop with one category still needs row one to exist, or the sticky index
  // lands on the first product and pins a burger to the top of the screen.
  /**
   * The pinned copy, over the list.
   *
   * `zIndex` as well as `elevation`: on Android a later sibling wins by
   * elevation and on iOS by zIndex, and this has to be above a list that is
   * scrolling underneath it on both.
   */
  catsPinned: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 10,
    backgroundColor: c.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  /**
   * A section heading inside the menu.
   *
   * Loud enough to find while scrolling past — this is what the chips jump to,
   * and a heading that reads like another product name gives somebody no way
   * to tell they have arrived. Drawn on the page colour so it separates from
   * the white product rows above and below it.
   */
  section: {
    ...typography.h3,
    color: c.text,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
    backgroundColor: c.bg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },

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
    borderRadius: 20,
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
    // 20 = (34 tall button + 3 padding each side) / 2. Not `radius.full`: a
    // very large radius renders as a square on small views under the new
    // architecture, which on a segmented control is a rounded button sitting
    // in a rectangle.
    borderRadius: 20,
    padding: 3,
  },
  toggleBtn: { paddingHorizontal: spacing.lg, paddingVertical: 7, borderRadius: 17 },
  toggleOn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.brand[500] },
  toggleText: { ...typography.label, color: c.gray[500], fontSize: 13 },
  toggleTextOn: { color: c.brand[700] },
  modePill: {
    backgroundColor: c.brand[50],
    borderRadius: 18,
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

  // SearchIcon + cats
  searchWrap: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchInput: { flex: 1, ...typography.body, color: c.text, padding: 0 },
  cats: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingVertical: 10 },
  cat: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    // 17, not `radius.full`: a very large radius renders as a square on small
    // views under the new architecture, and these are 34 points tall.
    borderRadius: 17,
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
  perUnit: { ...typography.tiny, color: c.gray[400] },
  offText: { ...typography.tiny, color: c.error },
  reserveBtn: {
    borderWidth: 1,
    borderColor: c.brand[500],
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  reserveText: { ...typography.tiny, color: c.brand[700], fontWeight: "700" },

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
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    height: 52,
  },
  cartCount: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  cartCountText: { ...typography.tiny, color: c.white, fontWeight: "800" },
  cartBarText: { ...typography.label, color: c.white, flex: 1, textAlign: "center", fontSize: 15 },
  cartBarCta: {
    width: 30,
    height: 30,
    borderRadius: 15,
    // On the brand-filled bar, so it takes the token for things sitting ON the
    // brand — not the white literal, which would follow neither theme.
    backgroundColor: c.onPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
});
