import React from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRightIcon } from "../../../common/ui/icons";
import { SmartImage } from "../../../common/ui/SmartImage";
import { spacing, typography, useColors } from "../../../theme";
import type { HomeBanner, HeroBanner } from "../services/marketplaceService";

/**
 * THE TOP OF HOME: ONE COLOURED BLOCK THAT CHANGES WITH ITS SLIDE.
 *
 * Asked for from foodpanda's screenshots: the address, the search and the
 * slider are not three bands — they are one block, and the WHOLE block takes
 * the colour of the slide in view, sliding from one to the next as the thumb
 * moves. It ends in a soft downward curve instead of a straight edge.
 *
 * ── Whose slides ──────────────────────────────────────────────────────
 *
 * The ADMIN's top-header banners (`placement: home_top`), when any are live:
 * each one's chosen colour becomes the block — "admin side sy jo color chose
 * ho wohi top header ka bny" — and it is shown nowhere else on the page. Made
 * of words (title, line, button, picture at the admin's size) or as one
 * finished 2:1 image edge to edge on that colour.
 *
 * With none, the app's own slides speak: a headline, a line and a button on
 * the palette's colours with a picture beside them. Photo cards were tried up
 * here and moved down to the strip — "top waly pehle waly e achy lg rahy thy".
 */
const AUTO_MS = 4500;
const ARC = 26;
/** An own slide's words end above the dots, which now sit on its bottom edge. */
const DOTS_ROOM = 18;

interface OwnSlide {
  id: string;
  title: string;
  body: string;
  cta: string;
  emoji: string;
  /** A bundled picture; the emoji is only the fallback. */
  art?: ImageSourcePropType;
  onPress?: () => void;
}

/** The size the app's own pictures sit at, and an admin picture's default. */
const PICTURE = 112;
/** The words-and-picture slide's height before the dots' room. */
const SLIDE = 132;

type Slide = HeroBanner | OwnSlide;
const isHero = (s: Slide): s is HeroBanner => "color" in s;

export function HomeHero({
  header,
  hero,
  onBanner,
  ownSlides,
  autoPlay,
}: {
  /** Address, menu, search — drawn on the block, above the slides. */
  header: React.ReactNode;
  /** The admin's top-header banners — only these, never the strip's. */
  hero: HeroBanner[];
  onBanner: (b: HomeBanner) => void;
  /** The app's own slides, shown only while no top banner is live. */
  ownSlides: OwnSlide[];
  /** Only while Home is the screen on top. */
  autoPlay: boolean;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  /*
   * The block's colours, from the palette — dark enough that white type and
   * the status bar's light glyphs read on every one of them.
   */
  const tones = React.useMemo(() => [c.primary, c.warm, c.ink, c.brand[700]], [c]);
  const slides: Slide[] = hero.length > 0 ? hero : ownSlides;
  // An admin banner wears its own colour; the app's own take the palette's.
  const colours = slides.map((s, i) => (isHero(s) ? s.color : tones[i % tones.length]));

  const x = React.useRef(new Animated.Value(0)).current;
  const list = React.useRef<Animated.FlatList<Slide>>(null);
  const [page, setPage] = React.useState(0);
  const touching = React.useRef(false);
  const [settled, setSettled] = React.useState(0);
  const [awake, setAwake] = React.useState(AppState.currentState === "active");
  const [still, setStill] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => alive && setStill(on))
      .catch(() => {});
    const sub = AppState.addEventListener("change", (s) => setAwake(s === "active"));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // Slides on its own — never under a thumb, in the background, or for
  // somebody who has asked the phone for less motion.
  const playing = autoPlay && awake && !still && slides.length > 1;
  React.useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (touching.current) return;
      const next = (page + 1) % slides.length;
      list.current?.scrollToOffset({ offset: next * width, animated: true });
      setPage(next);
    }, AUTO_MS);
    return () => clearTimeout(t);
  }, [playing, page, settled, slides.length, width]);

  React.useEffect(() => {
    if (page >= slides.length) setPage(0);
  }, [page, slides.length]);

  const background =
    colours.length > 1
      ? x.interpolate({ inputRange: colours.map((_, i) => i * width), outputRange: colours, extrapolate: "clamp" })
      : colours[0] ?? c.primary;

  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    touching.current = false;
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
    setSettled((n) => n + 1);
  };

  /*
   * ONE HEIGHT FOR EVERY SLIDE, or the block would jump as they change.
   * Artwork is shown whole at 2:1; words and a picture need the room their
   * biggest picture asks for, and never less than the app's own slides.
   */
  const artwork = slides.some((s) => isHero(s) && s.style === "artwork");
  const biggest = Math.max(0, ...slides.map((s) => (isHero(s) && s.image_url ? s.image_size ?? PICTURE : 0)));
  const wordsHeight = Math.max(SLIDE, biggest + spacing.ms);
  const slideHeight = artwork ? Math.max(Math.round(width / 2), wordsHeight) : wordsHeight;

  return (
    <View>
      <Animated.View style={{ backgroundColor: background, paddingTop: insets.top }}>
        {header}

        {/*
          The dots sit ON the slider's bottom edge, not in a band of their own
          under it — that band was 22 points of empty colour between the
          banner and the curve.
        */}
        <View>
        <Animated.FlatList
          ref={list}
          horizontal
          pagingEnabled
          data={slides}
          keyExtractor={(s) => s.id}
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: false })}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => {
            touching.current = true;
          }}
          onScrollEndDrag={() => {
            touching.current = false;
            setSettled((n) => n + 1);
          }}
          onMomentumScrollEnd={onSettled}
          renderItem={({ item }) =>
            isHero(item) && item.style === "artwork" ? (
              <Pressable
                style={{ width, height: slideHeight, justifyContent: "center" }}
                accessibilityRole="button"
                accessibilityLabel={item.title ?? "Promotion"}
                onPress={() => onBanner(item)}
              >
                {/*
                  EDGE TO EDGE, on the block's own colour, which the admin
                  picked to match the artwork — so it simply IS the block.
                */}
                <SmartImage
                  uri={item.image_url}
                  shimmer={false}
                  fallbackBackground="transparent"
                  style={{ width, height: Math.round(width / 2) }}
                />
              </Pressable>
            ) : (
              <Pressable
                style={[styles.slide, styles.own, { width, height: slideHeight + spacing.md + DOTS_ROOM }]}
                accessible
                accessibilityRole={isHero(item) || item.onPress ? "button" : undefined}
                accessibilityLabel={[item.title, item.body].filter(Boolean).join(". ")}
                onPress={isHero(item) ? () => onBanner(item) : item.onPress}
                disabled={!isHero(item) && !item.onPress}
              >
                <View style={styles.copy}>
                  <Text style={[styles.title, { color: c.textInverse }]} numberOfLines={3}>
                    {item.title}
                  </Text>
                  {!!item.body && (
                    <Text style={[styles.body, { color: c.textInverse }]} numberOfLines={2}>
                      {item.body}
                    </Text>
                  )}
                  {(() => {
                    const label = isHero(item) ? item.cta : item.onPress ? item.cta : null;
                    if (!label) return null;
                    // A white pill in the slide's own colour — a button, not a
                    // link, on any colour the admin picks.
                    const tone = isHero(item) ? item.color : colours[slides.indexOf(item)];
                    return (
                      <View style={[styles.ctaPill, { backgroundColor: c.surface }]}>
                        <Text style={[styles.cta, { color: tone }]}>{label}</Text>
                        <ChevronRightIcon size={14} color={tone} />
                      </View>
                    );
                  })()}
                </View>
                {isHero(item) ? (
                  item.image_url ? (
                    <SmartImage
                      uri={item.image_url}
                      shimmer={false}
                      fallbackBackground="transparent"
                      resizeMode="contain"
                      style={{ width: item.image_size ?? PICTURE, height: item.image_size ?? PICTURE }}
                    />
                  ) : null
                ) : item.art ? (
                  <Image source={item.art} style={styles.pic} />
                ) : (
                  <Text style={styles.emoji}>{item.emoji}</Text>
                )}
              </Pressable>
            )
          }
        />

        {slides.length > 1 && (
          <View style={styles.dotsWrap} pointerEvents="none">
            <View style={[styles.dots, { backgroundColor: c.surface }]}>
              {slides.map((s, i) => (
                <View
                  key={s.id}
                  style={[styles.dot, i === page ? styles.dotOn : styles.dotOff, { backgroundColor: i === page ? c.text : c.border }]}
                />
              ))}
            </View>
          </View>
        )}
        </View>
      </Animated.View>

      {/* The curve the block ends in — the same colour, an arc under it. */}
      <View style={styles.arcClip} pointerEvents="none">
        <Animated.View
          style={[
            styles.arc,
            // A circle four screens wide: its bottom ARC points are wider than
            // the screen, so the curve runs edge to edge with no shoulders.
            { backgroundColor: background, width: width * 4, height: width * 4, borderRadius: width * 2, left: -width * 1.5, top: -(width * 4) + ARC },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  own: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: DOTS_ROOM },
  copy: { flex: 1, gap: 6 },
  title: { ...typography.title, fontSize: 24, lineHeight: 30, fontWeight: "800" },
  body: { ...typography.small, opacity: 0.85 },
  ctaPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 2,
    marginTop: spacing.xs,
    borderRadius: 14,
    paddingLeft: spacing.ms,
    paddingRight: spacing.sm,
    paddingVertical: 6,
  },
  cta: { ...typography.label, fontSize: 13, lineHeight: 18 },
  emoji: { fontSize: 76 },
  pic: { width: PICTURE, height: PICTURE },
  dotsWrap: { position: "absolute", left: 0, right: 0, bottom: spacing.sm, alignItems: "center" },
  dots: {
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    opacity: 0.92,
  },
  dot: { height: 5, borderRadius: 3 },
  dotOn: { width: 22 },
  dotOff: { width: 5 },
  arcClip: { height: ARC, overflow: "hidden" },
  arc: { position: "absolute" },
});
