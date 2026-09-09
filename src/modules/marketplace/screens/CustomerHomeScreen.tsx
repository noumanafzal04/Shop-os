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
  GridIcon,
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
import { radius, spacing, type ThemeColors, typography, useColors, useTheme } from "../../../theme";
import { useLocationStore } from "../../../stores/locationStore";
import { useServingPin } from "../servingPin";
import { useHomeFeed } from "../hooks/useMarketplace";
import { formatDistance } from "../shopFacts";
import { PromoCarousel } from "../components/PromoCarousel";
import { ShopWithItems } from "../components/ShopWithItems";
import { Appear } from "../../../common/ui/Appear";
import { ShopFactsRow } from "../components/ShopFactsRow";
import { RatingChip } from "../components/RatingChip";
import { marketplaceService, type HomeBanner, type PublicShop } from "../services/marketplaceService";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { SHORTCUTS } from "../tradeIcon";
import { shortcutArt, tradeArt, useTileGround } from "../tileArt";
import { OfferBadge, Price } from "../../../common/ui/Price";
import { shopInitial, useShopCover } from "../shopCover";

/**
 * HOW MANY TRADES SHARE THE GRID — and the arithmetic behind the number.
 *
 * The grid is one wrapping container at a quarter-width per tile, so it reads
 * as rows of FOUR and the total is what matters:
 *
 *     4 shortcuts  +  HOME_TRADES  +  1 "View all"  =  8
 *
 * Three, therefore. It was four, which made nine — two full rows and a single
 * orphan tile on a third, which is what "aik remove krke View all 8th position
 * py set kro" was about. Change this and the last tile leaves the corner.
 */
const HOME_TRADES = 3;

/**
 * A trade code, roughly title-cased.
 *
 * The LAST remaining caller is a shop card's little type chip, where the shop
 * payload carries a raw `business_type` and no label. The tiles used to use
 * this too and now take the server's `label`, which is the real name —
 * "Mart & Grocery" rather than "Mart".
 *
 * Not worth an extra field on every shop in the feed for a chip that says
 * "Food"; worth stating that this is a fallback and not the naming rule.
 */
const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function CustomerHomeScreen() {
  const c = useColors();
  // The status bar's icons follow the PHONE's theme, not the brand: dark
  // glyphs on the light page, light on the dark one. Hard-coded
  // "light-content" was invisible against a white header.
  const { isDark } = useTheme();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const [menuOpen, setMenuOpen] = useState(false);
  const coverFor = useShopCover();
  const { status, label, detect } = useLocationStore();
  const pin = useServingPin();

  // First launch: resolve GPS → city automatically (foodpanda-style).
  useEffect(() => {
    if (status === "idle") detect();
  }, [status, detect]);

  const feed = useHomeFeed(pin);
  const ground = useTileGround();

  /**
   * HOW MANY TRADES THE HOME SCREEN SHOWS.
   *
   * Four, beside the four shortcuts, so the grid is two rows of four plus the
   * "View all" tile — one shape, whatever the marketplace grows into. It used
   * to render every trade the server returned and wrap, which at fourteen was
   * the whole top half of the screen.
   *
   * The server orders by shops_count, so these four are the four with the most
   * shops in them.
   */
  const tradeTiles = React.useMemo(
    () => (feed.data?.business_types ?? []).slice(0, HOME_TRADES),
    [feed.data],
  );
  const pull = usePullToRefresh(feed.refetch);

  const onBanner = async (b: HomeBanner) => {
    marketplaceService.bannerClick(b.id).catch(() => {});
    if (b.target.type === "shop" && b.target.shop_slug) {
      navigation.navigate("MarketShop", { slug: b.target.shop_slug });
    }
  };

  const openShop = (shop: PublicShop) => navigation.navigate("MarketShop", { slug: shop.slug });

  return (
    /*
      ── A WHITE PAGE WITH A BRANDED HEADER, NOT A BRANDED PAGE ──────

      The header was a solid brand-red block with rounded bottom corners, and
      `SafeScreen` painted the notch area red to match it. Reported as "primary
      color should be white as was first", "top notch issue" and "just show
      branding color": a full-bleed colour field behind the status bar is the
      loudest thing on a screen whose job is to show shops, and on a notched
      phone the red ran up behind the clock and the camera cut-out.

      So the page is its own ground in both themes, the status bar carries the
      page's colour and the phone's own icon polarity, and the brand appears
      where it says something — the pin, the filter, the tiles, the prices.
    */
    <SafeScreen backgroundColor={c.bg} edges={["top"]}>
      <FocusedStatusBar style={isDark ? "light-content" : "dark-content"} background={c.bg} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollGround}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={c.primary}
            // The header is part of the scroll now and no longer paints over
            // the spinner, so the old 140pt push-down left it hanging in the
            // middle of the tiles.
            progressViewOffset={0}
          />
        }
      >
        {/* ── Header: white, and the brand where it means something ── */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            {/*
              A hamburger, not an avatar.

              The avatar carried an initial and opened the menu, which made one
              control mean two things — and the Account TAB is now a full
              account page with the same initial on it, so the header was
              showing you who you were twice.
            */}
            <Touchable
              style={styles.iconBtn}
              onPress={() => setMenuOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Menu"
            >
              <MenuIcon size={21} color={c.text} />
            </Touchable>

            {/*
              ── THE ADDRESS LEADS, AND IT IS LEFT-ALIGNED ─────────────

              It was centred between two round buttons at 19pt, which is the
              biggest type on the screen spent on a line that is often forty
              characters of street address — reported as "location name too
              much big". A pin, one line, ellipsis, and the label above it in
              small caps: the control still says what it changes, and a long
              address no longer sets the height of the header.
            */}
            <Touchable
              style={styles.place}
              onPress={() => navigation.navigate("Location")}
              accessibilityRole="button"
              accessibilityLabel="Change delivery location"
            >
              <Text style={styles.placeLabel}>DELIVER TO</Text>
              <View style={styles.placeRow}>
                <MapPinIcon size={14} color={c.primary} />
                <Text style={styles.placeName} numberOfLines={1}>
                  {status === "locating" ? "Finding you…" : label ?? "Set your location"}
                </Text>
                <ChevronDownIcon size={13} color={c.textMuted} />
              </View>
            </Touchable>

            <Touchable
              style={styles.iconBtn}
              onPress={() => navigation.navigate("Notifications")}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <BellIcon size={20} color={c.text} />
            </Touchable>
          </View>

          {/*
            Search and filter in ONE control.

            They answer different questions — search finds a thing you can
            name, the aisle finds everything under Rs 500 — but they are the
            same gesture from the same place, and two separate round buttons
            beside a bar is three objects doing the work of one.

            The greeting line that used to sit above it is gone. "Hi Nouman" in
            23pt display type was a whole row of the header telling somebody
            their own name.
          */}
          <Touchable
            style={styles.searchBar}
            accessibilityRole="button"
            onPress={() => navigation.navigate("Search")}
          >
            <SearchIcon size={18} color={c.textMuted} />
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
              <SlidersIcon size={17} color={c.onPrimary} />
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
            {SHORTCUTS.map(({ key, label: shortcut, icon: Icon, tone, filters }) => {
              /**
               * ILLUSTRATED WHERE THERE IS A DRAWING, GLYPH WHERE THERE IS NOT.
               *
               * `tileArt` covers all four shortcuts and every trade the server
               * sends, so in practice the fallback never runs — but a tile with
               * no picture on it is a blank square on the home screen, and the
               * glyph set is right there.
               */
              const art = shortcutArt(key);

              return (
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
                      {
                        backgroundColor: art
                          ? ground(art)
                          // Solid amber, not a pale amber glyph on a paler
                          // amber tile — that pairing was 1.3:1 and the icon
                          // vanished.
                          : tone === "offer"
                            ? c.warm
                            : c.brand[100],
                      },
                    ]}
                  >
                    {art ? (
                      <art.Art size={30} />
                    ) : (
                      <Icon size={23} color={tone === "offer" ? c.onWarm : c.primary} />
                    )}
                  </View>
                  <Text style={styles.tileLabel} numberOfLines={1}>
                    {shortcut}
                  </Text>
                </Touchable>
              );
            })}

            {/*
              ── FOUR TRADES, NOT FOURTEEN ─────────────────────────────

              The grid is four shortcuts plus the trades, and it wraps — so a
              marketplace with fourteen trades in it turned the whole top half
              of the home screen into tiles before a single shop appeared.

              Four here and the rest one tap away. The cut is by SHOPS_COUNT,
              which the server already orders by, so the four on the home
              screen are the four with the most shops in them rather than the
              four that happen to sort first.
            */}
            {tradeTiles.map((t) => (
              <Touchable
                key={t.type}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={t.label}
                onPress={() =>
                  navigation.navigate("ShopList", {
                    business_type: t.type,
                    title: t.label,
                  })
                }
              >
                <View style={[styles.tileIcon, { backgroundColor: ground(tradeArt(t.type)) }]}>
                  {React.createElement(tradeArt(t.type).Art, { size: 30 })}
                </View>
                {/*
                  The label is the SERVER's. This used to capitalise the code,
                  so a mart read "Mart" while every other surface in the
                  product called it "Mart & Grocery".
                */}
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {t.label}
                </Text>
              </Touchable>
            ))}

            {/*
              ── THE WAY TO THE REST ───────────────────────────────────

              A tile, in the grid, on the same pitch as the others — not a
              "See all" link floating beside the heading. It is the fifth
              thing in a row of four, which is where a hand already is.

              ── Unconditional, and it was not ────────────────────────

              This used to render only when `business_types.length` exceeded
              the four tiles above it. The server sends the trades that HAVE
              shops and live had exactly four of them, so `4 > 4` was false
              and the only way to the categories page did not exist — a whole
              screen, registered and routed, that nobody could open. The
              question the condition was asking ("is there more to see") was
              the wrong one twice: that page now lists every trade the
              platform sells, not just the ones with shops, and the
              CATEGORIES inside each of them. There is always more to see.
            */}
            <Touchable
              style={styles.tile}
              accessibilityRole="button"
              accessibilityLabel="View all categories"
              onPress={() => navigation.navigate("Categories")}
            >
              <View style={[styles.tileIcon, styles.tileMore]}>
                <GridIcon size={22} color={c.textSecondary} />
              </View>
              <Text style={styles.tileLabel} numberOfLines={1}>
                View all
              </Text>
            </Touchable>

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
              /*
                NOT `EmptyState`. This is a HORIZONTAL rail inside a scrolling
                page — a full-screen centred panel with an icon plate would be
                a 300pt hole in the middle of the home screen. The shared
                component is for a screen whose whole job is that one list.
              */
              ListEmptyComponent={
                <Text style={styles.empty}>No shops around here yet — try widening your location.</Text>
              }
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
  scroll: { flex: 1, backgroundColor: c.bg },

  /**
   * ── THE HEADER IS PART OF THE PAGE NOW ──────────────────────────
   *
   * It was a brand-red slab with rounded bottom corners and white type on it.
   * One hairline under it does the same job — it separates the controls you
   * pass through from the shops you came for — and leaves the colour for the
   * things that mean something.
   */
  header: {
    backgroundColor: c.bg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  /** One shape for both round controls — they were `burger` and `bell`, two
   *  declarations of the same 42pt square that had drifted to two radii. */
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  // Left-aligned and allowed to shrink: a forty-character street address sets
  // the ellipsis, not the height of the header.
  place: { flex: 1, gap: 1, paddingHorizontal: spacing.xs },
  placeLabel: {
    ...typography.tiny,
    fontSize: 9,
    color: c.textMuted,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  placeName: { ...typography.label, color: c.text, fontSize: 14, flexShrink: 1 },
  searchFilter: {
    width: 34,
    height: 34,
    borderRadius: 17,
    // Solid brand, because it is the one control in the header that is a
    // destination rather than a field. `primarySoft` behind a brand glyph
    // measured 1.4:1 and read as disabled.
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 24,
    paddingLeft: spacing.md,
    paddingRight: 7,
    height: 48,
  },
  searchHint: { ...typography.body, color: c.textMuted, flex: 1 },

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
  /**
   * The "view all" tile is deliberately NOT brand-tinted.
   *
   * Eight orange tiles and a ninth orange tile is nine categories. A grey one
   * reads as the control it is — the way out of the row rather than another
   * thing in it.
   */
  tileMore: { backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },

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
