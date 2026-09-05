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
import { ArrowRight, Banknote, Bike, Store, type LucideIcon } from "lucide-react-native";
import { SafeScreen } from "../../common/ui/SafeScreen";
import { BRAND } from "../../common/brand";
import { tradeIcon } from "../marketplace/tradeIcon";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../theme";

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
 * ── Why the artwork is drawn and not photographed ────────────────────
 *
 * There are no photographs to use — the shops in this marketplace have not
 * uploaded any. A stock photo of somebody else's shop would be the one place
 * in the app showing a business that does not exist, on the screen that
 * introduces it. So each slide is a composition of the app's own icons, in the
 * app's own palette, at the app's own angles.
 */

interface Slide {
  icon: LucideIcon;
  /** Two more, drawn smaller and behind, so the artwork is a composition. */
  behind: [LucideIcon, LucideIcon];
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: Store,
    behind: [tradeIcon("food"), tradeIcon("mart")],
    title: "Your street, in your pocket",
    body: "Food, groceries and medicine from the shops closest to you — with what they actually have in stock today.",
  },
  {
    icon: Bike,
    behind: [tradeIcon("pharmacy"), Store],
    title: "One shop, one delivery",
    body: "A basket belongs to a single shop, so your order is prepared and delivered together. Adding from another shop starts a fresh basket — we always ask first.",
  },
  {
    icon: Banknote,
    behind: [Bike, Store],
    title: "Pay when it arrives",
    body: "Cash on delivery, every time. Nothing is charged up front, and you can follow your order from the moment the shop accepts it.",
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
            <Text style={styles.title}>{s.title}</Text>
            <Text style={styles.body}>{s.body}</Text>
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
          <ArrowRight size={20} color={c.onPrimary} strokeWidth={2.6} />
        </Pressable>
      </View>
    </SafeScreen>
  );
}

/**
 * Three tiles at three angles — the composition the reference gets from
 * overlapping photographs, built from icons instead.
 */
function Art({ slide }: { slide: Slide }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const Lead = slide.icon;
  const [A, B] = slide.behind;
  return (
    <View style={styles.art}>
      <View style={[styles.tile, styles.tileA]}>
        <A size={34} color={c.primary} strokeWidth={1.7} />
      </View>
      <View style={[styles.tile, styles.tileB]}>
        <B size={30} color={c.warm} strokeWidth={1.7} />
      </View>
      <View style={[styles.tile, styles.tileLead]}>
        <Lead size={58} color={c.onPrimary} strokeWidth={1.6} />
      </View>
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
    slide: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },

    art: {
      width: 220,
      height: 220,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.xl,
    },
    tile: {
      position: "absolute",
      borderRadius: radius.xl,
      alignItems: "center",
      justifyContent: "center",
    },
    // The icons sit in the EXPOSED corner of each tile, not its centre.
    //
    // Centred, they land underneath the lead tile: half a fork and half a
    // trolley poking out from behind a red square, which reads as clipping
    // rather than as a composition. Each one moves to the side of its tile the
    // lead tile does not cover.
    tileA: {
      width: 112,
      height: 136,
      left: -6,
      top: 8,
      paddingLeft: 14,
      alignItems: "flex-start",
      backgroundColor: c.primarySoft,
      transform: [{ rotate: "-8deg" }],
    },
    tileB: {
      width: 104,
      height: 124,
      right: -6,
      bottom: 2,
      padding: 14,
      alignItems: "flex-end",
      justifyContent: "flex-end",
      backgroundColor: c.warmSoft,
      transform: [{ rotate: "10deg" }],
    },
    tileLead: {
      width: 132,
      height: 156,
      backgroundColor: c.primary,
      transform: [{ rotate: "4deg" }],
    },

    title: { ...typography.display, fontSize: 26, color: c.text, textAlign: "center" },
    body: {
      ...typography.body,
      color: c.textSecondary,
      textAlign: "center",
      marginTop: spacing.sm,
      lineHeight: 22,
    },

    dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: spacing.md },
    dot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: c.border },
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
      borderRadius: radius.full,
      backgroundColor: c.primary,
    },
    nextWide: { width: "auto", paddingHorizontal: spacing.lg },
    nextPressed: { backgroundColor: c.primaryPressed },
    nextText: { ...typography.label, color: c.onPrimary, fontSize: 15 },
  });
