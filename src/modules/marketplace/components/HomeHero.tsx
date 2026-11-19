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
import type { HomeBanner } from "../services/marketplaceService";

/**
 * THE TOP OF HOME: ONE COLOURED BLOCK THAT CHANGES WITH ITS SLIDE.
 *
 * Asked for from foodpanda's screenshots: the address, the search and the
 * slider are not three bands — they are one block, and the WHOLE block takes
 * the colour of the slide in view, sliding from one to the next as the thumb
 * moves. It ends in a soft downward curve instead of a straight edge.
 *
 * An admin banner is artwork made at 2:1 (`BannerRequest::checkShape`), so it
 * is shown whole, as a rounded card in the block — never cropped to fit a
 * layout. With no banners sold, the app's own slides speak instead: a
 * headline, a line and a link, on the block's colour.
 */
const AUTO_MS = 4500;
const ARC = 26;

interface OwnSlide {
  id: string;
  title: string;
  body: string;
  cta: string;
  emoji: string;
  /** A bundled 3D picture; the emoji is only the fallback. */
  art?: ImageSourcePropType;
  onPress?: () => void;
}

export function HomeHero({
  header,
  banners,
  onBanner,
  ownSlides,
  autoPlay,
}: {
  /** Address, menu, search — drawn on the block, above the slides. */
  header: React.ReactNode;
  banners: HomeBanner[];
  onBanner: (b: HomeBanner) => void;
  /** The app's own slides, shown only while nobody has bought a banner. */
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
  const slides = banners.length > 0 ? banners : ownSlides;
  const colours = slides.map((_, i) => tones[i % tones.length]);

  const x = React.useRef(new Animated.Value(0)).current;
  const list = React.useRef<Animated.FlatList<HomeBanner | OwnSlide>>(null);
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

  // A banner is shown whole at 2:1; the app's own slides are words and a
  // picture, and need less height than artwork does.
  const slideHeight = banners.length > 0 ? Math.round(width / 2) : 132;

  return (
    <View>
      <Animated.View style={{ backgroundColor: background, paddingTop: insets.top }}>
        {header}

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
            "image_url" in item ? (
              <Pressable
                style={{ width, height: slideHeight }}
                accessibilityRole="button"
                accessibilityLabel={item.title ?? "Promotion"}
                onPress={() => onBanner(item)}
              >
                {/*
                  EDGE TO EDGE, on no ground of its own. As a rounded card it
                  showed a pale rim at the corners and a white shimmer while
                  loading — a seam in a block that is meant to be one colour.
                  The artwork is made in the block's colour, so whole-width it
                  simply IS the block.
                */}
                <SmartImage
                  uri={item.image_url}
                  shimmer={false}
                  fallbackBackground="transparent"
                  style={{ width, height: slideHeight }}
                />
              </Pressable>
            ) : (
              <Pressable
                style={[styles.slide, styles.own, { width, height: slideHeight + spacing.md }]}
                accessible
                accessibilityRole={item.onPress ? "button" : undefined}
                accessibilityLabel={`${item.title}. ${item.body}`}
                onPress={item.onPress}
                disabled={!item.onPress}
              >
                <View style={styles.copy}>
                  <Text style={[styles.title, { color: c.textInverse }]} numberOfLines={3}>
                    {item.title}
                  </Text>
                  <Text style={[styles.body, { color: c.textInverse }]} numberOfLines={2}>
                    {item.body}
                  </Text>
                  {!!item.onPress && (
                    <View style={styles.ctaRow}>
                      <Text style={[styles.cta, { color: c.textInverse }]}>{item.cta}</Text>
                      <ChevronRightIcon size={16} color={c.textInverse} />
                    </View>
                  )}
                </View>
                {item.art ? <Image source={item.art} style={styles.pic} /> : <Text style={styles.emoji}>{item.emoji}</Text>}
              </Pressable>
            )
          }
        />

        {slides.length > 1 && (
          <View style={styles.dotsWrap}>
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
  own: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  art: { width: "100%" },
  copy: { flex: 1, gap: 6 },
  title: { ...typography.title, fontSize: 24, lineHeight: 30, fontWeight: "800" },
  body: { ...typography.small, opacity: 0.85 },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 },
  cta: { ...typography.label, textDecorationLine: "underline" },
  emoji: { fontSize: 76 },
  pic: { width: 112, height: 112 },
  dotsWrap: { alignItems: "center", paddingTop: spacing.xs, paddingBottom: 4 },
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
