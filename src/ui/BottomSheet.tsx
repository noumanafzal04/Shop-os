import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XIcon } from "./icons";
import { radius, spacing, type ThemeColors, typography, useColors } from "../theme";

/**
 * The app's bottom sheet: one panel that rises from the bottom edge.
 *
 * ── Why it was rewritten ─────────────────────────────────────────────
 *
 * Reported in as many words: *"model transtion smooth ni — like drag down
 * and up krna jaise insta facebook, aise main model use hoty hai, waise ni
 * hain."* Three specific things were missing, and the first is the one that
 * made the other two matter:
 *
 *   1. THE GESTURE RAN ON THE JS THREAD. `PanResponder` calls back into
 *      JavaScript for every finger move and wrote the value from there. These
 *      sheets open over a screen that is usually still fetching, so the frame
 *      the finger moved on is exactly the frame JS was busy on. The panel
 *      stuttered, and no amount of spring tuning fixes a value that arrives
 *      late.
 *
 *   2. ONLY THE HEADER COULD BE DRAGGED. A 30pt strip at the top. Every app
 *      this was compared to lets you push the whole sheet down from anywhere
 *      on it, which is why nobody has to be told the gesture exists.
 *
 *   3. A FLICK WAS JUDGED BY DISTANCE. `dy > 96 || vy > 0.75` — two
 *      unrelated thresholds. A fast short flick is how people actually
 *      dismiss these, and it fell between them.
 *
 * Now: Reanimated shared values, so the panel follows the finger ON THE UI
 * THREAD and keeps up while JavaScript is blocked; the pan covers the whole
 * panel by default; and the release is judged by where the sheet WOULD land.
 *
 * ── The two halves still behave differently ──────────────────────────
 *
 * This part was right before and is kept. `<Modal animationType="slide">`
 * slides the dimmed backdrop and the panel together, as one grey block
 * travelling up the screen. Here the backdrop FADES in place and the panel
 * TRANSLATES, and the backdrop's opacity is derived from the panel's own
 * position — so a half-finished drag looks half-dismissed rather than fully
 * dark until the moment it lets go.
 */

/**
 * HOW FAR AHEAD A FLICK IS PROJECTED, in seconds.
 *
 * The release decision is "where would this sheet be in 120ms if nothing
 * stopped it", not "how far has it travelled" — which is how a fast, short
 * flick gets treated as the dismissal it obviously is. iOS uses a comparable
 * projection for its own scroll deceleration; the exact figure is tuned by
 * feel and 0.12 is the point at which a deliberate slow drag of 90pt still
 * springs back while a flick of 30pt leaves.
 */
const PROJECTION = 0.12;

/**
 * Past this much of THE PANEL'S OWN height, let go and it goes.
 *
 * The panel's own, measured — not `screen * maxHeightRatio`, which is what
 * the first version used and is the sheet's CEILING rather than its size. A
 * product sheet is about 1400pt tall on a phone whose ceiling is 2130, so a
 * "30%" threshold was really 45% of the thing being dragged: a decisive
 * flick of a quarter of the sheet sprang back, which is precisely the
 * feedback this rewrite is for.
 */
const DISMISS_RATIO = 0.3;

/**
 * One spring, used everywhere, so opening and settling feel like one object.
 *
 * `overshootClamping` is off now and that is the point of the rewrite: a
 * sheet that stops dead is a sheet that feels like a slideshow. The damping
 * is high enough that the overshoot is a single soft settle rather than a
 * wobble.
 */
const SPRING = {
  damping: 22,
  stiffness: 240,
  mass: 0.85,
  overshootClamping: false,
  restDisplacementThreshold: 0.5,
  restSpeedThreshold: 2,
  // Honours the OS switch rather than asking for it: with Reduce Motion on,
  // Reanimated runs this as a cut instead of a spring.
  reduceMotion: ReduceMotion.System,
} as const;

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** A control in the header's top-right — "Reset", usually. */
  action?: React.ReactNode;
  /** A pinned bar under the scroll: the sheet's primary action. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Share of the screen the panel may grow to. */
  maxHeightRatio?: number;
  /**
   * Limit the drag to the header, for a sheet that SCROLLS inside.
   *
   * The default is to drag from anywhere, which is what makes this feel like
   * the sheets it was compared to. A sheet with its own `ScrollView` cannot
   * have that: two gestures would claim the same downward finger, and the
   * one that wins is whichever the recogniser happens to pick — so the list
   * scrolls sometimes and the sheet moves other times.
   *
   * Coordinating them properly means watching the inner scroll offset and
   * enabling the pan only at the top, which needs a ref into somebody else's
   * child. One sheet in this app scrolls. It opts out; the other four get
   * the better gesture.
   */
  dragHandleOnly?: boolean;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  action,
  footer,
  children,
  maxHeightRatio = 0.88,
  dragHandleOnly = false,
}: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // Mounted is NOT `visible`. The panel has to stay in the tree long enough
  // to animate out — unmounting on the prop change is why sheets vanish
  // instead of closing.
  const [mounted, setMounted] = useState(visible);

  /** Distance below its open position, in points. 0 is open. */
  const y = useSharedValue(height);
  /** Where the panel was when this drag began. */
  const from = useSharedValue(0);
  /**
   * THE PANEL'S MEASURED HEIGHT, which is not its maximum.
   *
   * Seeded with the ceiling so the first frame has a usable number, then
   * replaced by `onLayout`. The release threshold is a share of THIS; see
   * `DISMISS_RATIO`.
   */
  const panelHeight = useSharedValue(height * maxHeightRatio);

  // The responder is built once, so it would otherwise close over the first
  // `onClose` this sheet ever received.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const requestClose = useCallback(() => onCloseRef.current(), []);
  const unmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = height;
      y.value = withSpring(0, SPRING);
    } else if (mounted) {
      /**
       * OUT IS A TIMING, IN IS A SPRING, and that asymmetry is deliberate.
       *
       * A spring on the way out has a tail — the last few points take as
       * long as the first eighty — and during that tail the sheet is a
       * ghost over a screen somebody has already moved on from. A fixed
       * 190ms leaves cleanly. Arriving is where the softness belongs.
       */
      y.value = withTiming(height, { duration: 190 }, (done) => {
        "worklet";
        if (done) runOnJS(unmount)();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Android's back button closes the sheet, not the screen behind it.
  useEffect(() => {
    if (!mounted || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [mounted, onClose]);

  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        /**
         * Claimed on MOVEMENT, and only downward movement.
         *
         * `activeOffsetY(8)` with no negative bound means an upward drag
         * never takes the gesture — so a button inside the sheet still gets
         * its press, and a horizontal swipe on a row of chips is not stolen.
         */
        .activeOffsetY(8)
        .failOffsetX([-20, 20])
        .onStart(() => {
          from.value = y.value;
        })
        .onUpdate((e) => {
          const next = from.value + e.translationY;
          /**
           * RUBBER BAND UPWARD. Dragging a sheet above its open position has
           * nowhere to go, and the old version simply ignored it — the panel
           * froze under a moving finger, which reads as a dropped frame.
           * A third of the distance says "there is nothing up here" while
           * still moving with the hand.
           */
          y.value = next < 0 ? next / 3 : next;
        })
        .onEnd((e) => {
          // Where it would be in PROJECTION seconds at this speed. See the
          // note on the constant: distance alone misjudges a flick.
          const projected = y.value + e.velocityY * PROJECTION;

          if (projected > panelHeight.value * DISMISS_RATIO) {
            runOnJS(requestClose)();
          } else {
            y.value = withSpring(0, SPRING);
          }
        }),
    [from, y, panelHeight, requestClose],
  );

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    // Derived from the panel's own position, so the dimming tracks a
    // half-finished drag instead of being on or off.
    opacity: interpolate(y.value, [0, height], [1, 0], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;

  const header = (
    <View>
      <View style={styles.grabber} />
      {/*
        THE CROSS IS ALWAYS THERE.

        This header only rendered when a sheet had a `title` or an `action` —
        so the product sheet, which has neither, could be left by dragging it
        down or tapping the dark behind it and by nothing else. Both are
        gestures somebody has to already know. A grabber is a hint; a cross
        is a control, and it costs 30 points in a corner nothing else wants.
      */}
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headEnd}>
          {action}
          <Pressable
            style={styles.close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
          >
            <XIcon size={17} color={c.textSecondary} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  const panel = (
    <Animated.View
      onLayout={(e) => {
        // The real height, once. A sheet whose content loads in grows, and
        // the threshold has to grow with it or a half-full sheet is harder
        // to flick away than a full one.
        panelHeight.value = e.nativeEvent.layout.height;
      }}
      style={[
        styles.panel,
        {
          maxHeight: height * maxHeightRatio,
          paddingBottom: insets.bottom,
        },
        panelStyle,
      ]}
    >
      {dragHandleOnly ? <GestureDetector gesture={pan}>{header}</GestureDetector> : header}
      {children}
      {footer != null && <View style={styles.footer}>{footer}</View>}
    </Animated.View>
  );

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
          />
        </Animated.View>

        {dragHandleOnly ? panel : <GestureDetector gesture={pan}>{panel}</GestureDetector>}
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    // Written out rather than spread from `StyleSheet.absoluteFill`, which is
    // a registered style ID and not an object: spreading it contributes
    // nothing, so the backdrop would have no size and the dimming would
    // simply not appear — with the type checker perfectly happy either way.
    backdrop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(10, 20, 24, 0.55)",
    },
    panel: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      overflow: "hidden",
    },
    grabber: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginTop: 10,
      marginBottom: 6,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      // 6, not `spacing.sm`: with no title this row is just the cross, and a
      // sheet that opens with an empty bar above its content has spent the
      // space a photograph wanted.
      paddingTop: 6,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    title: { ...typography.h3, color: c.text, flex: 1 },
    headEnd: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    close: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    footer: {
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
  });
