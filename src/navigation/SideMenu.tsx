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
  Bell,
  Bike,
  CalendarClock,
  ChevronRight,
  Heart,
  LifeBuoy,
  LogOut,
  MapPin,
  Pencil,
  Receipt,
  Settings,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { BRAND } from "../common/brand";
import { confirm } from "../common/ui/confirm";
import { spacing, type ThemeColors, typography, useColors } from "../theme";
import { useAuthStore } from "../stores/authStore";
import { useRiderProfile } from "../modules/rider/hooks/useRider";
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
  icon: LucideIcon;
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
  { icon: UserRound, label: "Account information", route: "Profile", needsAccount: true },
  { icon: Receipt, label: "My orders", route: "OrdersTab", needsAccount: true },
  { icon: MapPin, label: "Address management", route: "Addresses", needsAccount: true },
  { icon: Heart, label: "Favourites", route: "Favorites", needsAccount: true },
  { icon: CalendarClock, label: "Reservations", route: "Reservations", needsAccount: true },
];

const APP: Link[] = [
  { icon: Bell, label: "Notifications", route: "Notifications", needsAccount: true },
  { icon: Settings, label: "Settings", route: "Settings" },
  { icon: LifeBuoy, label: "Help centre", route: "Help" },
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
  const clearSession = useAuthStore((s) => s.clear);
  const signedIn = status === "authenticated";
  const rider = useRiderProfile();

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
        if (yes) clearSession().catch(() => {});
      })
      .catch(() => {});
  };

  const r = riderLink(rider.data);
  const riderOnline = rider.data?.status === "approved" && rider.data.is_online;

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
            <Pressable
              style={({ pressed }) => [styles.who, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={signedIn ? "Edit your profile" : "Sign in"}
              onPress={() => go({ route: signedIn ? "Profile" : "SignIn" })}
            >
              <View style={styles.avatar}>
                {signedIn && user?.name ? (
                  <Text style={styles.avatarText}>{user.name.trim().charAt(0).toUpperCase()}</Text>
                ) : (
                  <UserRound size={22} color={c.primary} strokeWidth={2.2} />
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
                  <>
                    <Pencil size={13} color={c.text} strokeWidth={2.2} />
                    <Text style={styles.editText}>Edit</Text>
                  </>
                ) : (
                  <Text style={styles.editText}>Sign in</Text>
                )}
              </View>
            </Pressable>

            {/* ── Riding ───────────────────────────────────────────── */}
            <Text style={styles.caption}>Riding</Text>
            <View style={styles.card}>
              <Row
                link={{ icon: Bike, label: r.label, route: r.route, needsAccount: true, value: r.value }}
                accent={riderOnline}
                onPress={() => go({ route: r.route, needsAccount: true })}
                last={!riderOnline}
              />
              {riderOnline && (
                <Row
                  link={{ icon: Wallet, label: "Earnings", route: "RiderEarnings", needsAccount: true }}
                  onPress={() => go({ route: "RiderEarnings", needsAccount: true })}
                  last
                />
              )}
            </View>

            {/* ── Account ──────────────────────────────────────────── */}
            <Text style={styles.caption}>Account</Text>
            <View style={styles.card}>
              {ACCOUNT.map((l, i) => (
                <Row key={l.label} link={l} onPress={() => go(l)} last={i === ACCOUNT.length - 1} />
              ))}
            </View>

            {/* ── Support ──────────────────────────────────────────── */}
            <Text style={styles.caption}>Support</Text>
            <View style={styles.card}>
              {APP.map((l, i) => (
                <Row key={l.label} link={l} onPress={() => go(l)} last={i === APP.length - 1 && !signedIn} />
              ))}
              {signedIn && (
                <Row
                  link={{ icon: LogOut, label: "Log out", route: "", tone: "danger" }}
                  onPress={signOut}
                  last
                />
              )}
            </View>

            <Text style={styles.brand}>{BRAND.name}</Text>
          </ScrollView>
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
      <Icon size={20} color={danger ? c.error : c.text} strokeWidth={1.8} />
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
      {!danger && <ChevronRight size={17} color={c.gray[300]} strokeWidth={2.2} />}
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

    scroll: { flex: 1 },
    list: { padding: spacing.sm, paddingBottom: spacing.lg },

    who: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: c.surface,
      borderRadius: 18,
      padding: 10,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.brand[100],
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { ...typography.title, color: c.primary, fontSize: 19 },
    whoCopy: { flex: 1, gap: 1 },
    whoName: { ...typography.label, color: c.text, fontSize: 15 },
    whoSub: { ...typography.tiny, color: c.textMuted, fontSize: 11.5 },
    editPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      borderRadius: 14,
      paddingHorizontal: 11,
      paddingVertical: 6,
    },
    editText: { ...typography.tiny, color: c.text, fontWeight: "700", fontSize: 11.5 },

    caption: {
      ...typography.tiny,
      color: c.textMuted,
      fontWeight: "700",
      fontSize: 11.5,
      paddingHorizontal: 6,
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

    brand: {
      ...typography.tiny,
      color: c.gray[300],
      textAlign: "center",
      paddingTop: spacing.lg,
    },
  });
