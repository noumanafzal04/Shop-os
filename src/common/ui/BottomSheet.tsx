import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../theme";

/**
 * The app's bottom sheet: one panel that rises from the bottom edge.
 *
 * ── Why this is hand-driven and not `animationType="slide"` ───────────
 *
 * `<Modal transparent animationType="slide">` slides the ENTIRE modal, the
 * dimmed backdrop included. So the dimming arrives at full strength already in
 * motion, travelling up the screen as a grey block with the panel welded to
 * it — which is what makes a sheet feel like it stuttered even when no frame
 * was dropped. There is nothing to fix in that animation; it is the wrong
 * animation.
 *
 * Here the two halves are separate and behave differently, which is what the
 * eye expects: the backdrop FADES in place, the panel TRANSLATES. Both are
 * transform/opacity only, so both run on the native driver and neither waits
 * on JavaScript — a filter sheet is opened over a screen that is usually still
 * fetching, and a JS-driven animation is exactly where that shows.
 *
 * ── Dragging ─────────────────────────────────────────────────────────
 *
 * Downward drag on the header follows the finger and dismisses past a
 * threshold, or springs back. The backdrop's opacity is INTERPOLATED from the
 * same value, so a half-finished drag looks half-dismissed rather than fully
 * dark until the moment it lets go.
 *
 * The gesture is claimed on the header only, never the body. Claiming it on
 * the whole panel means a sheet whose list cannot be scrolled down.
 */

/** How far down you must drag before letting go dismisses. */
const DISMISS_PX = 96;
/** Or how fast, for a flick that never travelled that far. */
const DISMISS_VELOCITY = 0.75;

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
}

export function BottomSheet({
  visible,
  onClose,
  title,
  action,
  footer,
  children,
  maxHeightRatio = 0.88,
}: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // Mounted is NOT `visible`. The panel has to stay in the tree long enough to
  // animate out — unmounting on the prop change is why sheets vanish instead
  // of closing.
  const [mounted, setMounted] = useState(visible);
  const y = useRef(new Animated.Value(height)).current;

  const animateOut = useCallback(
    (then: () => void) => {
      Animated.timing(y, {
        toValue: height,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) then();
      });
    },
    [height, y],
  );

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.setValue(height);
      Animated.spring(y, {
        toValue: 0,
        // Tuned to settle without a visible bounce: a filter sheet that
        // wobbles reads as slow even though it arrived sooner.
        damping: 30,
        stiffness: 260,
        mass: 0.9,
        overshootClamping: true,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      animateOut(() => setMounted(false));
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

  const pan = useRef(
    PanResponder.create({
      // Claimed on movement, not on touch: a tap on the title must still reach
      // the buttons beside it.
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        // Downward only. Dragging a sheet UP past its own top edge is a
        // gesture with nowhere to go.
        if (g.dy > 0) y.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DISMISS_PX || g.vy > DISMISS_VELOCITY) {
          onCloseRef.current();
        } else {
          Animated.spring(y, {
            toValue: 0,
            damping: 30,
            stiffness: 300,
            overshootClamping: true,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  // The responder is built once, so it would otherwise close over the first
  // `onClose` this sheet ever received.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  if (!mounted) return null;

  const dim = y.interpolate({
    inputRange: [0, height],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: dim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            {
              maxHeight: height * maxHeightRatio,
              paddingBottom: insets.bottom,
              transform: [{ translateY: y }],
            },
          ]}
        >
          <View {...pan.panHandlers}>
            <View style={styles.grabber} />
            {(title || action) && (
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
                    <X size={17} color={c.textSecondary} strokeWidth={2.4} />
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          {children}

          {footer != null && <View style={styles.footer}>{footer}</View>}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    // Written out rather than spread from `StyleSheet.absoluteFill`, which is a
    // registered style ID and not an object: spreading it contributes nothing,
    // so the backdrop would have no size and the dimming would simply not
    // appear — with the type checker perfectly happy either way.
    backdrop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(20, 12, 9, 0.55)",
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
      borderRadius: radius.full,
      backgroundColor: c.border,
      marginTop: 10,
      marginBottom: 6,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    title: { ...typography.h3, color: c.text, flex: 1 },
    headEnd: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    close: {
      width: 30,
      height: 30,
      borderRadius: radius.full,
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
