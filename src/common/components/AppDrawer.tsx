import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  BackHandler,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Touchable } from "@cartze/core/ui/Touchable";
import { ChevronRightIcon, type Icon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";

export interface DrawerItem {
  key: string;
  label: string;
  icon: Icon;
  hint?: string;
  /** A count that needs attention — orders waiting. Drawn red, never hidden in a hint. */
  badge?: number;
  onPress: () => void;
}

/** Where the shop stands right now, said at the top of the panel. */
export interface DrawerStatus {
  label: string;
  tone: "open" | "busy";
}

export interface DrawerSection {
  title: string;
  items: DrawerItem[];
}

const WIDTH = Math.min(320, Dimensions.get("window").width * 0.84);

/**
 * THE STRIP A SWIPE MAY START IN.
 *
 * 22 points — about a thumb's width of glass, and close to what both
 * platforms give their own back gestures. Wider and it eats the first card of
 * a horizontal rail; narrower and it is a gesture people try twice and then
 * stop trying. The same figure the customer app's `SideMenu` uses, because it
 * is the same thumb.
 */
const EDGE_WIDTH = 22;

/** How far it must be dragged before letting go commits to the new state. */
const OPEN_RATIO = 0.4;
const VELOCITY = 0.5;

/**
 * THE SIDEBAR.
 *
 * ── Why this is written rather than installed ────────────────────────
 *
 * The note here used to end: *"if a swipe-to-open gesture is ever wanted,
 * that is the moment to reconsider, not before."* It was wanted, so it was
 * reconsidered, and Gesture Handler and Reanimated are now installed in both
 * apps.
 *
 * `@react-navigation/drawer` is still not used, for a different reason: it is
 * a NAVIGATOR. This panel routes nothing — it is a sheet over whichever tab
 * is showing, carrying links, a shop header and a sign-out. Wrapping the app
 * in a second navigator to render it would be a large structural change for a
 * panel that slides.
 *
 * What a drawer has to do here is: slide in, dim what is behind it, close on
 * the scrim, close on Back, follow a finger both ways, and list some links.
 * That is a Modal, an Animated value, a translate and two gestures.
 *
 * ── What Gesture Handler bought ──────────────────────────────────────
 *
 * Both directions. Dragging it shut, and the way IN: an edge swipe has to
 * beat a horizontal rail and a vertical scroll to the same touch, and
 * `PanResponder` cannot express that — it asks one question once and then
 * owns the gesture. Gesture Handler states it as two conditions: "activate
 * after twelve points sideways" and "give up if the finger goes down".
 *
 * ── It closes on Android Back ────────────────────────────────────────
 *
 * A panel over the screen that Back does not dismiss is a trap: the hardware
 * button leaves the app instead, and the shopkeeper loses what they were
 * doing. `Modal`'s onRequestClose handles it, and the explicit listener is
 * belt and braces while the modal is open.
 */
export function AppDrawer({
  open,
  onClose,
  title,
  subtitle,
  sections,
  footer,
  onOpen,
  status,
  version,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** "Taking orders" / "Busy · back at 5:30 pm" — the first thing a shopkeeper checks. */
  status?: DrawerStatus;
  /** "True Serve Partner · v1.0" under the sign-out. */
  version?: string;
  sections: DrawerSection[];
  footer?: React.ReactNode;
  /**
   * Open it — the other half of `open`, and what the edge swipe needs.
   *
   * Optional: a screen whose content is itself a horizontal pager wants the
   * edge for the pager. Omitted, no strip is rendered at all, which is
   * different from a strip that catches a drag and does nothing with it.
   */
  onOpen?: () => void;
}) {
  const c = useColors();
  const s = styles(c);
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(open ? 0 : -WIDTH)).current;

  /**
   * "THE PANEL IS ALREADY WHERE THE FINGER PUT IT."
   *
   * The effect below animates from fully-closed to fully-open. That is right
   * for a tap on the hamburger and wrong for a drag, which has already placed
   * the panel somewhere in between — animating from -320 would snap it back
   * under the finger and then chase it.
   *
   * The gesture raises this before calling `onOpen`, and the effect reads it
   * as "mount, but do not animate". Cleared on release.
   */
  const draggingOpen = useRef(false);

  useEffect(() => {
    if (open && draggingOpen.current) return;
    Animated.timing(slide, {
      toValue: open ? 0 : -WIDTH,
      duration: open ? 220 : 160,
      // A transform, so this runs off the JS thread — the panel must not
      // stutter while the list behind it is still fetching.
      useNativeDriver: true,
    }).start();
  }, [open, slide]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const settle = useCallback(
    (shouldOpen: boolean) => {
      draggingOpen.current = false;
      if (shouldOpen) {
        Animated.spring(slide, {
          toValue: 0,
          damping: 30,
          stiffness: 300,
          overshootClamping: true,
          useNativeDriver: true,
        }).start();
      } else {
        // Through `onClose`, not straight to an animation: the parent holds
        // `open`, and animating shut behind its back leaves the panel hidden
        // with the parent still believing it is showing — the next tap on the
        // hamburger would then do nothing at all.
        onCloseRef.current();
      }
    },
    [slide],
  );

  /**
   * THE SWIPE IN, from the left edge.
   *
   * `runOnJS(true)` rather than a worklet, deliberately: the panel is an
   * `Animated.Value` on the native driver, and a Reanimated worklet cannot
   * write to one. Mixing two animation systems inside a single gesture to
   * save a few frames on a 220ms slide is a trade in the wrong direction.
   */
  const edge = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX(12)
    .failOffsetY([-14, 14])
    .onStart(() => {
      draggingOpen.current = true;
      slide.setValue(-WIDTH);
      onOpen?.();
    })
    .onUpdate((e) => {
      // Rightward only, and never past the open position.
      slide.setValue(Math.min(0, -WIDTH + Math.max(0, e.translationX)));
    })
    .onEnd((e) => {
      settle(e.translationX > WIDTH * OPEN_RATIO || e.velocityX > VELOCITY * 1000);
    })
    // A gesture the system interrupts — a call arriving, the app backgrounded
    // — must not leave the panel half out with nothing coming to finish it.
    .onFinalize((_e, ok) => {
      if (!ok && draggingOpen.current) settle(false);
    });

  /** And the swipe OUT, on the panel itself. Leftward only: there is nothing
   *  to the right of a panel already open. */
  const shut = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-12, 10000])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      slide.setValue(Math.max(-WIDTH, Math.min(0, e.translationX)));
    })
    .onEnd((e) => {
      settle(!(e.translationX < -WIDTH * OPEN_RATIO || e.velocityX < -VELOCITY * 1000));
    });

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const go = useCallback(
    (item: DrawerItem) => {
      // Closed FIRST, then navigate. Pushing a screen under an open modal
      // leaves the panel over the thing it just opened.
      onClose();
      item.onPress();
    },
    [onClose],
  );

  if (!open) {
    // Nothing to render once the gesture is not wanted — see `onOpen`.
    if (!onOpen) return null;

    return (
      <GestureDetector gesture={edge}>
        <View style={s.edge} accessible={false} importantForAccessibility="no-hide-descendants" />
      </GestureDetector>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close the menu" />

      <GestureDetector gesture={shut}>
      <Animated.View
        style={[
          s.panel,
          { paddingBottom: insets.bottom + spacing.md },
          { transform: [{ translateX: slide }] },
        ]}
      >
        {/*
          THE SHOP, IN ITS OWN BAND.

          The brand colour runs under the status bar, as every screen header
          in this app does — so opening the panel does not flash a white strip
          where the band was. A letter plate stands for the shop; the status
          chip is the answer to "are customers able to order right now?".
        */}
        <View style={[s.head, { paddingTop: insets.top + spacing.md }]}>
          <View style={s.plate} accessibilityElementsHidden importantForAccessibility="no">
            <Text style={s.plateText}>{(title.trim()[0] ?? "S").toUpperCase()}</Text>
          </View>
          <Text style={s.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={s.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {status ? (
            <View style={s.chip} accessibilityLabel={status.label}>
              <View style={[s.dot, { backgroundColor: status.tone === "busy" ? c.warning : c.success }]} />
              <Text style={s.chipText} numberOfLines={1}>
                {status.label}
              </Text>
            </View>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          {sections.map((section) => (
            <View key={section.title} style={s.section}>
              <Text style={s.sectionTitle}>{section.title}</Text>
              {section.items.map((item) => {
                const Glyph = item.icon;
                const count = item.badge ?? 0;
                return (
                  <Touchable
                    key={item.key}
                    onPress={() => go(item)}
                    accessibilityRole="button"
                    accessibilityLabel={count > 0 ? `${item.label}, ${count} waiting` : item.label}
                    style={s.row}
                  >
                    {/* A soft plate behind every glyph: one shape the eye can run down. */}
                    <View style={s.glyph}>
                      <Glyph size={20} color={c.primaryPressed} />
                    </View>
                    <View style={s.rowText}>
                      <Text style={s.rowLabel} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {item.hint ? (
                        <Text style={s.rowHint} numberOfLines={1}>
                          {item.hint}
                        </Text>
                      ) : null}
                    </View>
                    {count > 0 ? (
                      <View style={s.badge}>
                        <Text style={s.badgeText}>{count > 99 ? "99+" : count}</Text>
                      </View>
                    ) : (
                      <ChevronRightIcon size={18} color={c.textMuted} />
                    )}
                  </Touchable>
                );
              })}
            </View>
          ))}
        </ScrollView>

        {footer != null || version ? (
          <View style={s.footer}>
            {footer}
            {version ? <Text style={s.version}>{version}</Text> : null}
          </View>
        ) : null}
      </Animated.View>
      </GestureDetector>
    </Modal>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    scrim: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      backgroundColor: "rgba(10, 20, 17, 0.45)",
    },
    /**
     * THE EDGE STRIP — invisible, and that is the point.
     *
     * No colour and no size on screen: it exists so a gesture has something
     * to be attached TO. `top: 0, bottom: 0` rather than a height, so it
     * covers whatever the screen turns out to be, including a phone with its
     * keyboard up.
     */
    edge: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: EDGE_WIDTH,
    },
    panel: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: WIDTH,
      backgroundColor: c.surface,
      borderRightWidth: 1,
      borderRightColor: c.border,
    },
    head: {
      backgroundColor: c.primary,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.lg,
      gap: 2,
    },
    plate: {
      width: 52,
      height: 52,
      borderRadius: 16,
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    plateText: { ...typography.title, fontSize: 24, lineHeight: 30, color: c.onPrimary },
    title: { ...typography.title, color: c.onPrimary },
    subtitle: { ...typography.small, color: c.onPrimary, opacity: 0.85 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 6,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 5,
      borderRadius: 12,
      backgroundColor: c.surface,
    },
    dot: { width: 8, height: 8, borderRadius: 3 },
    chipText: { ...typography.label, fontSize: 13, lineHeight: 17, color: c.text },
    body: { paddingBottom: spacing.lg },
    section: { marginTop: spacing.md },
    sectionTitle: {
      ...typography.label,
      fontSize: 12,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: c.textMuted,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      minHeight: 56,
    },
    glyph: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: { flex: 1 },
    rowLabel: { ...typography.body, fontSize: 16, fontWeight: "600", color: c.text },
    rowHint: { ...typography.small, color: c.textMuted, marginTop: 1 },
    badge: {
      minWidth: 24,
      height: 22,
      paddingHorizontal: 6,
      borderRadius: 10,
      backgroundColor: c.error,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: { ...typography.label, fontSize: 12, lineHeight: 16, color: c.onPrimary },
    version: { ...typography.tiny, fontSize: 11, color: c.textMuted, textAlign: "center", marginTop: spacing.sm },
    footer: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
  });
