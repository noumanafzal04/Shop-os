import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import {
  BagIcon,
  BellIcon,
  CalendarIcon,
  ChevronRightIcon,
  FileTextIcon,
  GearIcon,
  HeartIcon,
  LifeBuoyIcon,
  MapPinIcon,
  MotorcycleIcon,
  PencilIcon,
  PersonIcon,
  ReceiptIcon,
  RefreshIcon,
  SignOutIcon,
  WalletIcon,
  type Icon,
} from "../common/ui/icons";
import { confirm } from "../common/ui/confirm";
import { Touchable } from "../common/ui/Touchable";
import { spacing, type ThemeColors, typography, useColors } from "../theme";
import { useAuthStore } from "../stores/authStore";
import { useLogout } from "../modules/auth/hooks/useAuth";
import { useRiderProfile } from "../modules/rider/hooks/useRider";
import { useModeStore } from "../stores/modeStore";
import type { RiderProfile } from "../modules/rider/services/riderService";

/**
 * The side menu.
 *
 * ── Why it is not `@react-navigation/drawer` ─────────────────────────
 *
 * That package needs Reanimated and Gesture Handler, neither of which is in
 * this app. Adding both — two native modules, a rebuild, a second animation
 * system beside the one the sheets already use — to gain a panel that slides
 * is a large permanent cost for a small thing.
 *
 * So this is the same construction as `BottomSheet`, turned ninety degrees:
 * backdrop fades, panel translates, both on the native driver, drag to close.
 *
 * ── The shape, and the one it replaced ───────────────────────────────
 *
 * It used to be a brand-coloured block at the top and then a flat run of rows
 * on the panel's own background. Two problems, and the second is the one that
 * made it read as unfinished: nothing grouped the rows except a caption, so
 * eleven links ran together as one column, and every icon sat in a tinted
 * tile, which put eleven coloured squares down the left edge competing with
 * each other.
 *
 * Now: a card for who you are, then CARDS of rows — white, rounded, hairline
 * between the rows inside each one — on a quiet ground. Grouping is done by
 * the card, so the caption above it can be small and calm; the icons are bare
 * and thin, so the eye lands on the words.
 *
 * ── What goes in here rather than on a tab ───────────────────────────
 *
 * The tabs are the five things somebody does over and over: browse, browse,
 * basket, orders, account. Everything ELSE that has a screen goes here —
 * addresses, favourites, help, settings — so the tab bar never grows a sixth
 * item and no screen is reachable only by remembering it exists.
 */

const DISMISS_PX = 60;
const DISMISS_VELOCITY = 0.6;

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface Link {
  icon: Icon;
  label: string;
  route: string;
  params?: object;
  /** A link that only means something once there is an account behind it. */
  needsAccount?: boolean;
  /** Right-hand text instead of a chevron — a status, not a destination. */
  value?: string;
  tone?: "danger";
}

const ACCOUNT: Link[] = [
  { icon: PersonIcon, label: "Account information", route: "Profile", needsAccount: true },
  { icon: ReceiptIcon, label: "My orders", route: "OrdersTab", needsAccount: true },
  { icon: MapPinIcon, label: "Address management", route: "Addresses", needsAccount: true },
  { icon: HeartIcon, label: "Favourites", route: "Favorites", needsAccount: true },
  { icon: CalendarIcon, label: "Reservations", route: "Reservations", needsAccount: true },
];

const APP: Link[] = [
  { icon: BellIcon, label: "Notifications", route: "Notifications", needsAccount: true },
  { icon: GearIcon, label: "Settings", route: "Settings" },
  { icon: LifeBuoyIcon, label: "Help centre", route: "Help" },
];

/**
 * ON SHIFT, the menu is a different menu.
 *
 * Not the shopping one with two rows greyed out — a rider has no addresses to
 * manage, no favourites and no reservations, and offering them is offering
 * work the app cannot do in this mode. What is left is the job, the money, the
 * paperwork, and the way back.
 */
const RIDER_WORK: Link[] = [
  // Through the tab navigator by name, the same way the basket is reached from
  // a shop screen. A bare tab name would bubble up to the stack, find nothing,
  // and warn — navigating to a nested route means naming both halves.
  { icon: MotorcycleIcon, label: "My deliveries", route: "RiderTabs", params: { screen: "RiderBoardTab" }, needsAccount: true },
  { icon: WalletIcon, label: "Earnings", route: "RiderTabs", params: { screen: "RiderEarningsTab" }, needsAccount: true },
  { icon: FileTextIcon, label: "My rider account", route: "RiderApply", needsAccount: true },
];

/**
 * The rider entry, in the rider's own words for where they are.
 *
 * One row that says four different things, because four different people open
 * this menu: somebody who has never heard of it, somebody mid-application,
 * somebody waiting, and somebody about to start a shift. A single "Rider"
 * link would be the same word for all four and useful to none.
 */
function riderLink(profile: RiderProfile | null | undefined): { label: string; value?: string; route: string } {
  if (profile == null) {
    return { label: "Become a rider", value: "Earn daily", route: "RiderApply" };
  }
  switch (profile.status) {
    case "draft":
      return { label: "Rider application", value: "Not sent", route: "RiderApply" };
    case "pending":
      return { label: "Rider application", value: "Under review", route: "RiderApply" };
    case "rejected":
      return { label: "Rider application", value: "Fix and resend", route: "RiderApply" };
    case "suspended":
      return { label: "Rider account", value: "Suspended", route: "RiderApply" };
    default:
      return {
        label: "Rider mode",
        value: profile.is_online ? "Online" : "Offline",
        route: "RiderHome",
      };
  }
}

export function SideMenu({ visible, onClose }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<any>();

  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  // The SAME sign-out the account screen uses. This file used to call
  // `authStore.clear()` on its own, which skipped revoking the server token
  // and skipped unregistering this device from push — two buttons, two
  // different amounts of signing out.
  const logout = useLogout();
  const signedIn = status === "authenticated";
  const rider = useRiderProfile();
  const mode = useModeStore((s) => s.mode);
  const switchTo = useModeStore((s) => s.switchTo);
  const onShift = mode === "rider";
  const canRide = rider.data?.status === "approved";

  const panelWidth = Math.min(330, width * 0.86);
  const [mounted, setMounted] = useState(visible);
  const x = useRef(new Animated.Value(-panelWidth)).current;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const animateOut = useCallback(
    (then: () => void) => {
      Animated.timing(x, {
        toValue: -panelWidth,
        duration: 190,
        useNativeDriver: true,
      }).start(({ finished }) => finished && then());
    },
    [panelWidth, x],
  );

  useEffect(() => {
    if (visible) {
      setMounted(true);
      x.setValue(-panelWidth);
      Animated.spring(x, {
        toValue: 0,
        damping: 30,
        stiffness: 250,
        mass: 0.9,
        overshootClamping: true,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      animateOut(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
      onMoveShouldSetPanResponder: (_e, g) => g.dx < -6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        // Leftward only. There is nothing to the right of a panel already open.
        if (g.dx < 0) x.setValue(g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -DISMISS_PX || g.vx < -DISMISS_VELOCITY) {
          onCloseRef.current();
        } else {
          Animated.spring(x, {
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

  if (!mounted) return null;

  const dim = x.interpolate({
    inputRange: [-panelWidth, 0],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  /**
   * Close first, then go.
   *
   * Navigating with the panel still up leaves it animating over a screen it no
   * longer belongs to, and on Android the panel's own back handler is still
   * installed while the new screen is drawing.
   */
  const go = (link: Pick<Link, "route" | "params" | "needsAccount">) => {
    onClose();
    if (link.needsAccount && !signedIn) {
      navigation.navigate("SignIn");
      return;
    }
    navigation.navigate(link.route, link.params);
  };

  const signOut = () => {
    onClose();
    confirm
      .ask({
        title: "Sign out?",
        message: "Your basket stays on this phone.",
        confirmLabel: "Sign out",
        cancelLabel: "Stay",
        tone: "danger",
      })
      .then((yes) => {
        if (yes) logout.mutate();
      })
      .catch(() => {});
  };

  const r = riderLink(rider.data);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: dim }]}>
          <Pressable
            style={styles.fill}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            onPress={onClose}
          />
        </Animated.View>

        <Animated.View
          {...pan.panHandlers}
          style={[
            styles.panel,
            {
              width: panelWidth,
              paddingTop: insets.top + spacing.sm,
              paddingBottom: insets.bottom,
              transform: [{ translateX: x }],
            },
          ]}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Who you are ──────────────────────────────────────── */}
            <Touchable
              style={styles.who}
              accessibilityRole="button"
              accessibilityLabel={signedIn ? "Edit your profile" : "Sign in"}
              onPress={() => go({ route: signedIn ? "Profile" : "SignIn" })}
            >
              <View style={styles.avatar}>
                {signedIn && user?.name ? (
                  <Text style={styles.avatarText}>{user.name.trim().charAt(0).toUpperCase()}</Text>
                ) : (
                  <PersonIcon size={24} color={c.onPrimary} />
                )}
              </View>
              <View style={styles.whoCopy}>
                <Text style={styles.whoName} numberOfLines={1}>
                  {signedIn ? (user?.name ?? "Your account") : "Welcome"}
                </Text>
                <Text style={styles.whoSub} numberOfLines={1}>
                  {signedIn ? (user?.email ?? user?.phone ?? "Signed in") : "Sign in to order"}
                </Text>
              </View>
              <View style={styles.editPill}>
                {signedIn ? (
                  <PencilIcon size={14} color={c.primary} />
                ) : (
                  <Text style={styles.editText}>Sign in</Text>
                )}
              </View>
            </Touchable>

            {/* ── The lists ────────────────────────────────────────── */}
            {onShift ? (
              <>
                <Text style={styles.caption}>Your shift</Text>
                <View style={styles.card}>
                  {RIDER_WORK.map((l, i) => (
                    <Row key={l.label} link={l} onPress={() => go(l)} last={i === RIDER_WORK.length - 1} />
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.caption}>Account</Text>
                <View style={styles.card}>
                  {ACCOUNT.map((l, i) => (
                    <Row key={l.label} link={l} onPress={() => go(l)} last={i === ACCOUNT.length - 1} />
                  ))}
                </View>
              </>
            )}

            <Text style={styles.caption}>Support</Text>
            <View style={styles.card}>
              {APP.map((l, i) => (
                <Row key={l.label} link={l} onPress={() => go(l)} last={i === APP.length - 1} />
              ))}
            </View>

          </ScrollView>

          {/*
            ── PINNED, because these two are not destinations ──────────

            Everything above is a place to go and belongs in the scroll. These
            two CHANGE WHAT THE APP IS, and a control that changes the app
            should not be something you have to go looking for at the bottom of
            a list — which is exactly what happened: the switch existed for
            weeks and was asked for by somebody who had it.

            The switch is also shown to people who cannot use it yet, greyed,
            with the reason on it. A control that appears only once you qualify
            is a control nobody knows to qualify FOR.
          */}
          <View style={styles.footer}>
            {signedIn && (
              <Touchable
                style={[
                  styles.switcher,
                  onShift && styles.switcherOn,
                  !canRide && styles.switcherOff,
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canRide }}
                accessibilityLabel={
                  !canRide
                    ? "Become a rider"
                    : onShift
                      ? "Switch to shopping"
                      : "Switch to rider mode"
                }
                onPress={() => {
                  onClose();
                  if (!canRide) {
                    navigation.navigate("RiderApply");
                    return;
                  }
                  switchTo(onShift ? "customer" : "rider");
                }}
              >
                <View style={styles.switcherIcon}>
                  {onShift ? (
                    <BagIcon size={19} color={c.onPrimary} />
                  ) : (
                    <MotorcycleIcon size={19} color={c.onPrimary} />
                  )}
                </View>
                <View style={styles.switcherCopy}>
                  <Text style={styles.switcherTitle}>
                    {!canRide ? r.label : onShift ? "Switch to shopping" : "Switch to rider mode"}
                  </Text>
                  <Text style={styles.switcherHint} numberOfLines={1}>
                    {!canRide
                      ? (r.value ?? "Deliver orders and earn")
                      : onShift
                        ? "Browse shops and order"
                        : rider.data?.is_online
                          ? "You are online"
                          : "Go online and take deliveries"}
                  </Text>
                </View>
                {canRide ? (
                  <RefreshIcon size={17} color={c.onPrimary} />
                ) : (
                  <ChevronRightIcon size={17} color={c.onPrimary} />
                )}
              </Touchable>
            )}

            {signedIn && (
              <Touchable
                style={styles.logout}
                accessibilityRole="button"
                accessibilityLabel="Log out"
                onPress={signOut}
              >
                <SignOutIcon size={18} color={c.error} />
                <Text style={styles.logoutText}>Log out</Text>
              </Touchable>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Row({
  link,
  onPress,
  last,
  accent,
}: {
  link: Link;
  onPress: () => void;
  last?: boolean;
  /** A live state worth a colour — "Online" is the only one so far. */
  accent?: boolean;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const Icon = link.icon;
  const danger = link.tone === "danger";

  return (
    <Pressable
      style={({ pressed }) => [styles.row, !last && styles.rowDivided, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={link.label}
      onPress={onPress}
    >
      {/*
        Brand-coloured, and bare. Every icon used to be `c.text`, which made
        the left edge of the panel a column of grey glyphs — and the version
        before that gave each one a tinted TILE, eleven coloured squares
        competing down the same edge. Colour on the mark itself is the middle
        one: the list has life and still reads as a list.
      */}
      <Icon size={20} color={danger ? c.error : c.primary} />
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]} numberOfLines={1}>
        {link.label}
      </Text>
      {!!link.value && (
        <View style={styles.valueWrap}>
          {accent && <View style={styles.dot} />}
          <Text style={[styles.value, accent && styles.valueOn]} numberOfLines={1}>
            {link.value}
          </Text>
        </View>
      )}
      {!danger && <ChevronRightIcon size={17} color={c.gray[300]} />}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, flexDirection: "row" },
    fill: { flex: 1 },
    backdrop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(20, 12, 9, 0.55)",
    },
    panel: {
      // The panel's own ground is the QUIET one and the cards on it are white,
      // which is the inverse of the rest of the app. That is what makes a
      // group of rows read as a group without a border around it.
      backgroundColor: c.bg,
      borderTopRightRadius: 24,
      borderBottomRightRadius: 24,
      overflow: "hidden",
    },

    /**
     * PINNED. The scroll ends above it, never behind it.
     *
     * A hairline and the page colour rather than a shadow: this app draws no
     * shadows anywhere, and a floating bar with a halo under it would be the
     * only one.
     */
    footer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.surface,
      padding: spacing.sm,
      gap: spacing.xs,
    },

    scroll: { flex: 1 },
    list: { padding: spacing.sm, paddingBottom: spacing.lg },

    /**
     * TINTED, not white.
     *
     * Every card in this panel was the same white on the same grey, so the one
     * that says who you are — the thing the panel opens with — had no more
     * weight than "Reservations". A brand tint costs nothing and gives the top
     * of the panel somewhere for the eye to land first.
     */
    who: {
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      backgroundColor: c.brand[50],
      borderWidth: 1,
      borderColor: c.brand[100],
      borderRadius: 18,
      padding: 11,
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      // FILLED, where it used to be a tint holding tinted text. An avatar is
      // the one place a menu is allowed to be loud.
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { ...typography.title, color: c.onPrimary, fontSize: 20 },
    whoCopy: { flex: 1, gap: 1 },
    whoName: { ...typography.label, color: c.text, fontSize: 15 },
    whoSub: { ...typography.tiny, color: c.textMuted, fontSize: 11.5 },
    editPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: c.surface,
      borderRadius: 16,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    editText: { ...typography.tiny, color: c.text, fontWeight: "700", fontSize: 11.5 },

    /**
     * FILLED, because it is the loudest thing this menu does.
     *
     * It was a tinted card among tinted cards and somebody who HAD it asked
     * where it was. A control that replaces the entire app should not have to
     * be found.
     *
     * Green on shift, brand off it — the colour says which way the switch will
     * take you rather than which mode you are in, because the label already
     * says that.
     */
    switcher: {
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      backgroundColor: c.success,
      borderRadius: 16,
      padding: 11,
    },
    switcherOn: { backgroundColor: c.primary },
    /**
     * NOT YET APPROVED — and still the brand colour.
     *
     * It was grey, on the reasoning that a control you cannot use should not
     * shout. Wrong reading of what it is: this is not a disabled switch, it is
     * an INVITATION, and it leads somewhere useful — the application. Greying
     * out the one row that asks somebody to start earning is the opposite of
     * what it should do.
     */
    switcherOff: { backgroundColor: c.primary },
    switcherIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(255,255,255,0.22)",
      alignItems: "center",
      justifyContent: "center",
    },
    switcherCopy: { flex: 1, gap: 1 },
    switcherTitle: { ...typography.label, color: c.onPrimary, fontSize: 14 },
    switcherHint: { ...typography.tiny, color: "rgba(255,255,255,0.85)", fontSize: 11.5 },

    logout: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.errorBg,
      backgroundColor: c.errorBg,
      paddingVertical: 11,
    },
    logoutText: { ...typography.label, color: c.error, fontSize: 14 },

    caption: {
      ...typography.tiny,
      color: c.textMuted,
      fontWeight: "800",
      fontSize: 10.5,
      // Uppercase and spaced: a caption should read as a label on a drawer,
      // not as another row that happens to be smaller.
      textTransform: "uppercase",
      letterSpacing: 1.1,
      paddingHorizontal: 8,
      marginTop: spacing.md,
      marginBottom: 7,
    },

    card: { backgroundColor: c.surface, borderRadius: 18, overflow: "hidden" },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 13,
      height: 50,
    },
    // Inset to start under the LABEL, not under the icon — a full-width rule
    // reads as a separator between sections, which is what the card already is.
    rowDivided: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    pressed: { opacity: 0.6 },
    rowLabel: { ...typography.body, color: c.text, fontSize: 14.5, fontWeight: "500", flex: 1 },
    rowLabelDanger: { color: c.error, fontWeight: "600" },

    valueWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.success },
    value: { ...typography.tiny, color: c.textMuted, fontSize: 11.5, fontWeight: "600" },
    valueOn: { color: c.success },

  });
