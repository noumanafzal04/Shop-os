import React, { useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  ArrowRightIcon,
} from "../../common/ui/icons";
import {
  BanknoteIcon,
  MotorcycleIcon,
  StorefrontIcon,
  type Icon,
} from "../../common/ui/icons";
import { SafeScreen } from "../../common/ui/SafeScreen";
import { BRAND } from "../../common/brand";
import { tradeIcon } from "../marketplace/tradeIcon";
import { spacing, type ThemeColors, typography, useColors } from "../../theme";

/**
 * The three things worth knowing before the first order.
 *
 * ── Why these three and not a tour ───────────────────────────────────
 *
 * An introduction earns its place by answering questions the app cannot
 * answer in passing. Two of these are rules people otherwise meet as
 * REFUSALS:
 *
 *   · one basket belongs to one shop, so adding from a second shop offers to
 *     start a new one — which reads as a bug if it arrives unannounced;
 *   · payment is cash on delivery, which is the first thing anybody wants to
 *     know and currently appears at the bottom of checkout.
 *
 * The third simply says what the app is for. Nothing here explains a button.
 *
 * ── "Achi modern, images import krlo" — and why there are none ────────
 *
 * Asked for photographs. There are none to use, and the reason is not effort:
 *
 *   · the shops in this marketplace have not uploaded any, so a stock photo
 *     would be the one place in the app showing a business that does not
 *     exist — on the screen that introduces the app;
 *   · a licensed pack is megabytes in the APK for three screens seen once;
 *   · and photographs of food make a promise about the food, which belongs to
 *     the shop selling it rather than to us.
 *
 * So the slides got the OTHER thing that reads as modern, and does not depend
 * on owning a picture: a full-bleed coloured panel, one large mark, and type
 * with room around it. Each slide takes its own hue from the tile palette, so
 * the three are a set rather than three copies.
 *
 * If real photographs ever arrive — a shop's own, with permission — the panel
 * is one `<SmartImage>` away from carrying them, and the composition below is
 * already the right shape for it.
 */

interface Slide {
  icon: Icon;
  /** Two more, drawn smaller and behind, so the artwork is a composition. */
  behind: [Icon, Icon];
  title: string;
  body: string;
  /** The panel behind the mark: [ground, the mark's own tone]. */
  hue: readonly [string, string];
}

/**
 * Three grounds, deep enough to carry white type.
 *
 * Not the tile palette's washes — those are backgrounds for a 26px glyph and
 * would be a pale smear across half a phone. These are the same hues at the
 * weight a full-bleed panel needs.
 */
const PANEL = {
  orange: ["#e94e00", "#ffd9c4"],
  green: ["#3f6f14", "#d8ecb8"],
  blue: ["#14477e", "#c2dcf7"],
} as const;

const SLIDES: Slide[] = [
  {
    icon: StorefrontIcon,
    behind: [tradeIcon("food"), tradeIcon("mart")],
    title: "Your street, in your pocket",
    body: "Food, groceries and medicine from the shops closest to you — with what they actually have in stock today.",
    hue: PANEL.orange,
  },
  {
    icon: MotorcycleIcon,
    behind: [tradeIcon("pharmacy"), StorefrontIcon],
    title: "One shop, one delivery",
    body: "A basket belongs to a single shop, so your order is prepared and delivered together. Adding from another shop starts a fresh basket — we always ask first.",
    hue: PANEL.green,
  },
  {
    icon: BanknoteIcon,
    behind: [MotorcycleIcon, StorefrontIcon],
    title: "Pay when it arrives",
    body: "Cash on delivery, every time. Nothing is charged up front, and you can follow your order from the moment the shop accepts it.",
    hue: PANEL.blue,
  },
];

interface Props {
  onDone: () => void;
}

export function OnboardingScreen({ onDone }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Rounded from the offset rather than tracked by the button, so a SWIPE
    // moves the dots too — the reference's control is the arrow, but the
    // gesture is what people actually use.
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  const advance = () => {
    if (last) {
      onDone();
      return;
    }
    scroller.current?.scrollTo({ x: width * (index + 1), animated: true });
  };

  return (
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.top}>
        <Text style={styles.wordmark}>{BRAND.name}</Text>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {SLIDES.map((s) => (
          <View key={s.title} style={[styles.slide, { width }]}>
            <Art slide={s} />
            <View style={styles.copy}>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View key={s.title} style={[styles.dot, i === index && styles.dotOn]} />
        ))}
      </View>

      <View style={styles.controls}>
        <Pressable
          style={styles.skip}
          accessibilityRole="button"
          accessibilityLabel="Skip introduction"
          onPress={onDone}
          // Hidden on the last slide rather than removed: a control that
          // disappears shifts the row it was in.
          disabled={last}
        >
          <Text style={[styles.skipText, last && styles.skipGone]}>Skip</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.next, last && styles.nextWide, pressed && styles.nextPressed]}
          accessibilityRole="button"
          accessibilityLabel={last ? "Start shopping" : "Next"}
          onPress={advance}
        >
          {last && <Text style={styles.nextText}>Start shopping</Text>}
          <ArrowRightIcon size={20} color={c.onPrimary} />
        </Pressable>
      </View>
    </SafeScreen>
  );
}

/**
 * A PANEL, not a pile of tiles.
 *
 * It was three small rounded squares at three angles, which is the shape a
 * composition of PHOTOGRAPHS makes and a poor shape for three glyphs: at that
 * size the angles read as a mistake rather than as an arrangement, and the
 * whole thing sat in the middle of a white page looking like a placeholder.
 *
 * One coloured field, one mark at the size a mark deserves, and the two
 * supporting glyphs reduced to quiet marks on the ground — there to give the
 * field some life, not to be read. The panel is the artwork; the icons are
 * texture in it.
 */
function Art({ slide }: { slide: Slide }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const Lead = slide.icon;
  const [A, B] = slide.behind;
  const [ground, soft] = slide.hue;

  return (
    <View style={[styles.panel, { backgroundColor: ground }]}>
      {/*
        Two circles bleeding off the edges. Cheap, and they do the job a
        photograph's background does — stop a flat field reading as an area
        that failed to load.
      */}
      <View style={styles.blobTop} />
      <View style={styles.blobBottom} />

      <View style={[styles.ghost, styles.ghostLeft]}>
        <A size={30} color={soft} />
      </View>
      <View style={[styles.ghost, styles.ghostRight]}>
        <B size={26} color={soft} />
      </View>

      <Lead size={104} color="#ffffff" />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    top: { alignItems: "center", paddingTop: spacing.md },
    wordmark: {
      ...typography.label,
      color: c.primary,
      letterSpacing: 1.4,
      textTransform: "uppercase",
    },

    pager: { flex: 1 },
    /**
     * Top-aligned, not centred.
     *
     * The panel is a fixed height and the body copy is three lines on one
     * slide and five on another. Centring the pair makes the panel sit at a
     * different height on each slide, so paging between them slides the
     * artwork up and down — which reads as the layout settling rather than as
     * a deliberate change of subject.
     */
    slide: { alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

    /**
     * THE ARTWORK IS A FIELD, not a pile of tiles.
     *
     * Three small rounded squares at three angles is the shape a composition
     * of PHOTOGRAPHS makes, and a poor shape for three glyphs: at that size
     * the angles read as a mistake, and the whole thing sat in the middle of a
     * white page looking like something that had not loaded.
     *
     * `overflow: hidden` is what lets the blobs below bleed off the edges
     * instead of squaring themselves against it.
     */
    panel: {
      width: "100%",
      height: 300,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      marginBottom: spacing.xl,
    },
    // Two circles, half off the edge. A flat field with nothing in it reads as
    // an area that failed to load; this is the cheapest thing that fixes it.
    // Lit from the top, shaded at the bottom — the two tints are fixed, so
    // they live here rather than inline. Translucent white and black, so one
    // pair works on all three grounds without a colour per slide.
    blobTop: {
      position: "absolute", width: 260, height: 260, borderRadius: 130,
      top: -120, right: -90, backgroundColor: "rgba(255,255,255,0.10)",
    },
    blobBottom: {
      position: "absolute", width: 220, height: 220, borderRadius: 110,
      bottom: -110, left: -70, backgroundColor: "rgba(0,0,0,0.10)",
    },
    // The supporting glyphs — texture on the ground, not things to be read.
    ghost: { position: "absolute", opacity: 0.55 },
    ghostLeft: { left: 30, top: 44 },
    ghostRight: { right: 34, bottom: 46 },

    copy: { paddingHorizontal: spacing.sm },

    title: {
      ...typography.display,
      fontSize: 27,
      lineHeight: 33,
      color: c.text,
      textAlign: "center",
      letterSpacing: -0.4,
    },
    body: {
      ...typography.body,
      color: c.textSecondary,
      textAlign: "center",
      marginTop: spacing.sm,
      lineHeight: 23,
      // Near 42 characters a line on a phone. Full-width body copy on a 400pt
      // screen is a paragraph nobody finishes.
      maxWidth: 340,
      alignSelf: "center",
    },

    dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: spacing.md },
    dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.border },
    // A pill, not a bigger circle: the active step reads as "further along"
    // rather than merely "selected".
    dotOn: { width: 22, backgroundColor: c.primary },

    controls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      paddingTop: spacing.sm,
    },
    skip: { paddingVertical: 12, paddingHorizontal: spacing.md },
    skipText: { ...typography.label, color: c.textSecondary },
    skipGone: { opacity: 0 },

    next: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      width: 58,
      height: 58,
      borderRadius: 22,
      backgroundColor: c.primary,
    },
    nextWide: { width: "auto", paddingHorizontal: spacing.lg },
    nextPressed: { backgroundColor: c.primaryPressed },
    nextText: { ...typography.label, color: c.onPrimary, fontSize: 15 },
  });
