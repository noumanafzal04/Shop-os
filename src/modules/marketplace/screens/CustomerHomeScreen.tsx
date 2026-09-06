import React, { useEffect, useState } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  BellIcon,
  ChevronDownIcon,
  MapPinIcon,
  MenuIcon,
  SearchIcon,
  SlidersIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { Touchable } from "../../../common/ui/Touchable";
import { SmartImage } from "../../../common/ui/SmartImage";
import { SideMenu } from "../../../navigation/SideMenu";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { Skeleton, SkeletonShopCard } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import { useLocationStore } from "../../../stores/locationStore";
import { useHomeFeed } from "../hooks/useMarketplace";
import { formatDistance } from "../shopFacts";
import { PromoCarousel } from "../components/PromoCarousel";
import { ShopWithItems } from "../components/ShopWithItems";
import { Appear } from "../../../common/ui/Appear";
import { ShopFactsRow } from "../components/ShopFactsRow";
import { RatingChip } from "../components/RatingChip";
import { marketplaceService, type HomeBanner, type PublicShop } from "../services/marketplaceService";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { SHORTCUTS, tradeIcon } from "../tradeIcon";
import { OfferBadge, Price } from "../../../common/ui/Price";
import { shopInitial, useShopCover } from "../shopCover";

const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function CustomerHomeScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const [menuOpen, setMenuOpen] = useState(false);
  const coverFor = useShopCover();
  const { status, lat, lng, label, detect } = useLocationStore();

  // First launch: resolve GPS → city automatically (foodpanda-style).
  useEffect(() => {
    if (status === "idle") detect();
  }, [status, detect]);

  const feed = useHomeFeed({ lat: lat ?? undefined, lng: lng ?? undefined });
  const pull = usePullToRefresh(feed.refetch);
  const firstName = user?.name?.split(" ")[0];

  const onBanner = async (b: HomeBanner) => {
    marketplaceService.bannerClick(b.id).catch(() => {});
    if (b.target.type === "shop" && b.target.shop_slug) {
      navigation.navigate("MarketShop", { slug: b.target.shop_slug });
    }
  };

  const openShop = (shop: PublicShop) => navigation.navigate("MarketShop", { slug: shop.slug });

  return (
    <SafeScreen backgroundColor={c.brand[500]} edges={["top"]}>
      <FocusedStatusBar style="light-content" background={c.brand[500]} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollGround}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={c.brand[500]}
            // The scroll view starts UNDER the red header, so the spinner's
            // default position is on top of the welcome line.
            progressViewOffset={140}
          />
        }
      >
        {/* ── Green hero header ─────────────────────────────────── */}
        <View style={styles.header}>
          {/*
            The ADDRESS leads, not a greeting.
            
            It was "Welcome, / Nouman" in display type with the delivery
            location tucked underneath in small caps — which puts the app's
            most consequential control, the one that decides which shops even
            appear, third in the reading order behind a word that tells nobody
            anything. A person's own name is not news to them.
          */}
          <View style={styles.headerTop}>
            {/*
              A hamburger, not an avatar.

              The avatar carried an initial and opened the menu, which made one
              control mean two things — and the Account TAB is now a full
              account page with the same initial on it, so the header was
              showing you who you were twice.
            */}
            <Touchable
              style={styles.burger}
              onPress={() => setMenuOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Menu"
            >
              <MenuIcon size={21} color={c.white} />
            </Touchable>

            <Touchable
              style={styles.place}
              onPress={() => navigation.navigate("Location")}
              accessibilityRole="button"
              accessibilityLabel="Change delivery location"
            >
              <View style={styles.placeLabelRow}>
                <Text style={styles.placeLabel}>Deliver to</Text>
                <ChevronDownIcon size={13} color={c.brand[200]} />
              </View>
              <View style={styles.placeRow}>
                <MapPinIcon size={15} color={c.white} />
                <Text style={styles.placeName} numberOfLines={1}>
                  {status === "locating" ? "Finding you…" : label ?? "Set your location"}
                </Text>
              </View>
            </Touchable>

            <Touchable
              style={styles.bell}
              onPress={() => navigation.navigate("Notifications")}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <BellIcon size={20} color={c.white} />
            </Touchable>
          </View>

          {/*
            One short line.

            The first version — "Hi Nouman, what are you looking for?" — wrapped
            onto two lines of 25px display type and turned the header into a
            third of the screen before a single shop appeared. A header is a
            place you pass through.
          */}
          <Text style={styles.headline} numberOfLines={1}>
            {firstName ? `Hi ${firstName}` : "Welcome"}
          </Text>

          {/*
            Search and filter in ONE control.

            They answer different questions — search finds a thing you can
            name, the aisle finds everything under Rs 500 — but they are the
            same gesture from the same place, and two separate round buttons
            beside a bar is three objects doing the work of one.
          */}
          <Touchable
            style={styles.searchBar}
            accessibilityRole="button"
            onPress={() => navigation.navigate("Search")}
          >
            <SearchIcon size={18} color={c.gray[400]} />
            <Text style={styles.searchHint} numberOfLines={1}>
              Search food, groceries, medicine…
            </Text>
            <Touchable
              style={styles.searchFilter}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Browse and filter all products"
              onPress={() => navigation.navigate("Browse")}
            >
              <SlidersIcon size={17} color={c.primary} />
            </Touchable>
          </Touchable>
        </View>

        {/* ── Light content area ────────────────────────────────── */}
        <View style={styles.body}>
          {/*
            One request builds this whole screen — banners, nearby, top rated,
            deals. So one failure does not empty a section, it empties the page,
            and the page then says "No shops around here yet" about a city full
            of them.
          */}
          {feed.isError && (
            <LoadFailed
              what="shops near you"
              error={feed.error}
              onRetry={() => feed.refetch()}
              retrying={feed.isFetching}
            />
          )}
          {/*
            ONE grid, two kinds of shortcut.

            They were built as two components — a fixed row of 70px tiles with
            a 58px rounded square, and a horizontal scroller of 64px tiles with
            a 56px circle. Four squares over four circles, at two sizes, on two
            pitches: nothing lined up vertically and the eye read eight
            unrelated buttons rather than two rows of the same thing.

            The KINDS still differ — the first four narrow the aisle, the rest
            open a trade — and that is a difference of destination, not of
            drawing. So one tile, one size, one column pitch, and a single
            `flexWrap` row that keeps them aligned however many trades the
            server sends.
          */}
          <View style={styles.tiles}>
            {SHORTCUTS.map(({ key, label: shortcut, icon: Icon, tone, filters }) => (
              <Touchable
                key={key}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={shortcut}
                onPress={() => navigation.navigate("Browse", { title: shortcut, filters })}
              >
                <View
                  style={[
                    styles.tileIcon,
                    // Solid amber, not a pale amber glyph on a paler amber
                    // tile — that pairing was 1.3:1 and the icon vanished.
                    { backgroundColor: tone === "offer" ? c.warm : c.brand[100] },
                  ]}
                >
                  <Icon
                    size={23}
                    color={tone === "offer" ? c.onWarm : c.primary}
                  />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {shortcut}
                </Text>
              </Touchable>
            ))}

            {(feed.data?.business_types ?? []).map((t) => (
              <Touchable
                key={t.type}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={typeLabel(t.type)}
                onPress={() =>
                  navigation.navigate("ShopList", {
                    business_type: t.type,
                    title: typeLabel(t.type),
                  })
                }
              >
                <View style={styles.tileIcon}>
                  {React.createElement(tradeIcon(t.type), {
                    size: 23,
                    color: c.primary
                  })}
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {typeLabel(t.type)}
                </Text>
              </Touchable>
            ))}

            {feed.isLoading &&
              [0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.tile}>
                  <Skeleton width={56} height={56} borderRadius={18} />
                  <Skeleton width={44} height={10} borderRadius={4} />
                </View>
              ))}
          </View>

          {/* Out-of-service notice */}
          {status === "unserved" && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                We're not in your area yet — showing everything instead.
              </Text>
            </View>
          )}

          {/*
            Always rendered, even with nothing sold: the strip carries the
            app's own placeholders instead, so the home screen does not change
            shape depending on whether anyone bought an advert.
          */}
          <PromoCarousel banners={feed.data?.banners ?? []} onPress={onBanner} />

          {/* Near you */}
          <SectionHeader
            title="Near you"
            onSeeAll={() => navigation.navigate("ShopList", { title: "Near you" })}
          />
          {feed.isLoading ? (
            <View style={styles.hRow}>
              {[0, 1].map((i) => (
                <SkeletonShopCard key={i} />
              ))}
            </View>
          ) : (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={feed.data?.nearby ?? []}
              keyExtractor={(s) => s.slug}
              contentContainerStyle={styles.hRow}
              ListEmptyComponent={<Text style={styles.empty}>No shops around here yet.</Text>}
              renderItem={({ item }) => <ShopCard shop={item} onPress={() => openShop(item)} />}
            />
          )}

          {/* Deals — % off product carousel (like "Dishes up to 35% off") */}
          {(feed.data?.deals.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Deals for you" />
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={feed.data!.deals}
                keyExtractor={(d) => d.id}
                contentContainerStyle={styles.hRow}
                renderItem={({ item }) => (
                  <Touchable
                    style={styles.dealCard}
                    onPress={() => item.shop && navigation.navigate("MarketShop", { slug: item.shop.slug })}
                  >
                    {/*
                      The cover is keyed on the DEAL, not on its shop: a shop's
                      three offers sitting side by side in one colour looks like
                      one card repeated. Keyed per item they read as three
                      things, which is what they are.
                    */}
                    <View style={styles.dealImgWrap}>
                      <SmartImage
                        uri={item.image}
                        fallback={shopInitial(item.name)}
                        fallbackBackground={coverFor(item.id).bg}
                        fallbackColor={coverFor(item.id).fg}
                        style={styles.dealImg}
                      />
                      {/*
                        The server scored and sorted this rail by `percent_off`,
                        so its own number is passed through rather than
                        recomputed — two rounded rupee figures can disagree with
                        the ordering of the list they are sitting in.
                      */}
                      <OfferBadge
                        value={item.price}
                        was={item.original_price}
                        percent={item.percent_off}
                        style={styles.offBadge}
                      />
                    </View>
                    <View style={styles.dealBody}>
                      <Text style={styles.dealName} numberOfLines={1}>{item.name}</Text>
                      {/*
                        `money()`, by way of `Price`. This row built its own
                        string with `"Rs " + n.toLocaleString()`, which is the
                        eighth copy of a formatter that lives in one file
                        precisely so a decimal from the server cannot come out
                        as "Rs NaN" on one screen and correct on the next.
                      */}
                      <Price value={item.price} was={item.original_price} size="md" tone="brand" />
                      <Text style={styles.dealShop} numberOfLines={1}>
                        {item.shop?.business_name}
                        {item.distance_km != null ? ` · ${formatDistance(item.distance_km)}` : ""}
                      </Text>
                    </View>
                  </Touchable>
                )}
              />
            </>
          )}

          {/* Top rated */}
          {(feed.data?.top_rated.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Top rated" />
              <View style={styles.grid}>
                {feed.data!.top_rated.map((s) => (
                  <ShopCard key={s.slug} shop={s} wide onPress={() => openShop(s)} />
                ))}
              </View>
            </>
          )}

          {/*
            ── The long tail, and it is the reason to keep scrolling ────

            This used to be a grid of shop NAMES. A directory asks somebody to
            open four shops to find out which has what they want; three
            thumbnails of the actual items answers it on the card.

            A SECOND banner slot sits a few shops down. One at the top is an
            advert somebody scrolls past on the way in; one placed after they
            have started browsing is one they are in the mood to read — which
            is where every marketplace of this shape puts it.
          */}
          {(feed.data?.nearby.length ?? 0) > 0 && (
            <>
              <SectionHeader
                title="All shops"
                onSeeAll={() => navigation.navigate("ShopList", { title: "All shops" })}
              />
              {feed.data!.nearby.map((s, i) => (
                <React.Fragment key={`x-${s.slug}`}>
                  {/*
                    INSET, like everything else on the page.

                    These were the one block on the home screen with no
                    horizontal padding — the rails, the grid and the tiles are
                    all 16 in from the edge and the long tail ran to the glass.
                    Asked about directly: "cards edge ks sath q lga diye?" The
                    answer was that the card carried no margin and the list
                    that renders it had none either, so nothing was deciding.
                  */}
                  <Appear index={i} style={styles.tailCard}>
                    <ShopWithItems
                      shop={s}
                      onOpen={() => openShop(s)}
                      onItem={(productId) =>
                        navigation.navigate("MarketShop", { slug: s.slug, productId })
                      }
                    />
                  </Appear>

                  {i === 2 && (feed.data?.banners.length ?? 0) > 0 && (
                    <View style={styles.midBanners}>
                      <PromoCarousel banners={feed.data!.banners} onPress={onBanner} />
                    </View>
                  )}
                </React.Fragment>
              ))}
            </>
          )}

          <View style={{ height: spacing.xxl }} />
        </View>
      </ScrollView>

      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </SafeScreen>
  );
}

function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onSeeAll && (
        <Touchable onPress={onSeeAll} hitSlop={8}>
          <Text style={styles.seeAll}>See all</Text>
        </Touchable>
      )}
    </View>
  );
}

function ShopCard({ shop, wide = false, onPress }: { shop: PublicShop; wide?: boolean; onPress: () => void }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const coverFor = useShopCover();
  const closed = shop.is_open_now === false;
  const cover = coverFor(shop.slug);

  /**
   * TWO SHAPES, AND THE DIFFERENCE IS THE RAIL.
   *
   * "bary shops cards" — the rail card was 240 points wide and spent 58 of
   * them on a logo and the rest on two lines of type, which is a list row that
   * happens to be sideways. A card in a rail has no neighbours above or below
   * to be read against, so it has to carry its own weight: a cover band, then
   * the name under it. That is the shape every marketplace uses for exactly
   * this slot, and it is the reason those rails read as a shelf.
   *
   * The WIDE one stays a row on purpose. Full width with a 120pt cover band
   * would be three shops per screen, and "Top rated" is a shortlist somebody
   * is comparing — comparing wants rows.
   */
  if (wide) {
    return (
      <Touchable style={[styles.wideCard, closed && styles.shopClosed]} onPress={onPress}>
        <View style={styles.wideLogo}>
          <SmartImage
            uri={shop.logo_path}
            fallback={shopInitial(shop.business_name)}
            fallbackBackground={cover.bg}
            fallbackColor={cover.fg}
            style={styles.wideLogoImg}
          />
          {closed && (
            <View style={styles.shutTag}>
              <Text style={styles.shutText}>Shut</Text>
            </View>
          )}
        </View>
        <View style={styles.shopInfo}>
          {/*
            The name and the rating on ONE line, the chip pinned right — the
            same shape as every other card, so a rating is always in the same
            place whichever list somebody is reading.
          */}
          <View style={styles.wideNameRow}>
            <Text style={styles.wideName} numberOfLines={1}>{shop.business_name}</Text>
            <RatingChip rating={shop.rating} />
          </View>
          <Text style={styles.shopMeta} numberOfLines={1}>
            {typeLabel(shop.business_type ?? "shop")}
            {shop.city ? ` · ${shop.city.name}` : ""}
          </Text>
          {/*
            `closed` is NOT passed: the cover already carries a "Shut" tag, and
            saying it twice on one card spends the row's slots on a fact the
            eye has already had.
          */}
          <ShopFactsRow shop={shop} limit={3} />
        </View>
      </Touchable>
    );
  }

  return (
    <Touchable style={[styles.railCard, closed && styles.shopClosed]} onPress={onPress}>
      {/*
        A COVER BAND, not a pale letter tile.

        Every card carried the same brand-50 square with a red initial in it, so
        a row of shops was a row of identical pink squares — which reads as a
        page whose images failed rather than as a page designed without any.
        The colour is derived from the slug, so a shop looks the same on every
        screen and two shops never look like one. It follows the theme now as
        well: see `shopCover.ts`, and the six grounds it no longer uses.
      */}
      <View style={[styles.railCover, { backgroundColor: cover.bg }]}>
        <SmartImage
          uri={shop.logo_path}
          fallback={shopInitial(shop.business_name)}
          fallbackBackground={cover.bg}
          fallbackColor={cover.fg}
          style={styles.railCoverImg}
        />
        <RatingChip rating={shop.rating} variant="plate" style={styles.railRating} />
        {closed && (
          <View style={styles.railShut}>
            <Text style={styles.shutText}>Closed</Text>
          </View>
        )}
      </View>

      <View style={styles.railBody}>
        <Text style={styles.railName} numberOfLines={1}>{shop.business_name}</Text>
        {/*
          Two facts, not three: the rating is on the cover already, and this
          card is 264 wide — a fee, a distance and a prep time run past its own
          edge and are cut off mid-word by the card beside it.
        */}
        <ShopFactsRow shop={shop} limit={2} />
      </View>
    </Touchable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  scroll: { flex: 1, backgroundColor: c.brand[500] },

  // Header
  header: {
    backgroundColor: c.brand[500],
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  burger: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  place: { flex: 1, alignItems: "center", gap: 1, paddingHorizontal: spacing.sm },
  placeLabelRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  placeLabel: { ...typography.tiny, color: c.brand[200], fontWeight: "600", letterSpacing: 0.3 },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%" },
  headline: {
    ...typography.display,
    fontSize: 23,
    color: c.white,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  searchFilter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  placeName: { ...typography.title, color: c.white, fontSize: 19, flexShrink: 1 },
  bell: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderRadius: radius.full,
    paddingLeft: spacing.md,
    paddingRight: 8,
    height: 52,
  },
  searchHint: { ...typography.body, color: c.gray[400], flex: 1 },

  // Body
  // The page colour, behind the header's rounded bottom corners as well as
  // under the content. `SafeScreen` paints this screen brand red so the status
  // bar matches the header — which also meant the header's corners revealed
  // red on red and the rounding could not be seen at all.
  scrollGround: { backgroundColor: c.bg },
  body: { backgroundColor: c.bg, minHeight: 600 },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.sm,
    marginTop: spacing.md,
  },
  // A quarter of the row, so a fifth tile starts a second row directly under
  // the first — the reason both kinds of shortcut share one container.
  tile: { width: "25%", alignItems: "center", gap: 6, marginBottom: spacing.md },
  // A tinted tile, not an outlined white box. The outline made identical
  // frames and left the glyph to do all the work; the tint makes them read as
  // one set of buttons before anyone reads a label.
  tileIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: c.brand[100],
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: { ...typography.tiny, color: c.textSecondary, fontWeight: "600" },

  notice: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: c.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: { ...typography.small, color: c.warning },


  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: 12,
  },
  sectionTitle: { ...typography.h3, color: c.text, fontSize: 18.5 },
  // Breathing room around the mid-page advert, so it reads as its own thing
  // rather than as a shop card that lost its name.
  midBanners: { marginTop: spacing.xs, marginBottom: spacing.md },
  seeAll: { ...typography.label, color: c.brand[600] },

  // 12 between siblings, 16 to the page edge. They were both 8, which is the
  // gap that makes a rail read as one striped block instead of as cards.
  hRow: { paddingHorizontal: spacing.md, gap: 12, paddingVertical: 2 },
  grid: { paddingHorizontal: spacing.md, gap: 12 },
  tailCard: { paddingHorizontal: spacing.md },
  empty: { ...typography.small, color: c.gray[400], paddingVertical: spacing.md },

  // ── Rail card ────────────────────────────────────────────────────
  // 264, not 240: the cover band needs to read as a picture rather than as a
  // stripe, and two-thirds of a third card peeking in at the right edge is
  // what tells a thumb the rail scrolls.
  railCard: {
    width: 264,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
  },
  railCover: { height: 118, alignItems: "center", justifyContent: "center" },
  railCoverImg: { width: "100%", height: "100%" },
  railRating: { position: "absolute", top: 8, right: 8 },
  railShut: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(12,7,5,0.72)",
    paddingVertical: 4,
  },
  railBody: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 1 },
  railName: { ...typography.h3, color: c.text, fontSize: 16 },

  // ── Wide row ─────────────────────────────────────────────────────
  wideCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: 12,
  },
  wideLogo: { width: 64, height: 64, borderRadius: 16, overflow: "hidden" },
  wideLogoImg: { width: 64, height: 64 },
  wideNameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  wideName: { ...typography.h3, color: c.text, fontSize: 15.5, flexShrink: 1 },

  shopClosed: { opacity: 0.72 },
  // Over the cover rather than beside the name: on a closed shop the cover is
  // the first thing the eye lands on, and it is the fact that decides whether
  // to read the rest.
  shutTag: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(12,7,5,0.72)",
    paddingVertical: 2,
  },
  shutText: {
    ...typography.tiny,
    color: "#ffffff",
    textAlign: "center",
    fontWeight: "800",
    fontSize: 9.5,
  },
  shopInfo: { flex: 1, gap: 2 },
  shopMeta: { ...typography.tiny, color: c.textMuted },

  // Deals carousel
  dealCard: {
    width: 176,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  dealImgWrap: {
    height: 124,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  dealImg: { width: "100%", height: "100%" },
  dealInitial: { fontSize: 40, fontWeight: "800", letterSpacing: -1 },
  // Position only — `OfferBadge` owns its own fill, and that fill is AMBER.
  // It was `brand[500]`, which is the colour of every button in this app, on a
  // label nobody can press, sitting on a photograph.
  offBadge: { position: "absolute", left: 8, top: 8 },
  dealBody: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 3 },
  dealName: { ...typography.label, color: c.text, fontSize: 14.5 },
  dealShop: { ...typography.tiny, color: c.gray[500] },
});
