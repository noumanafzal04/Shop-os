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
  CalendarClock,
  ChevronRight,
  Heart,
  LifeBuoy,
  LogOut,
  MapPin,
  Receipt,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { BRAND } from "../common/brand";
import { confirm } from "../common/ui/confirm";
import { radius, spacing, type ThemeColors, typography, useColors } from "../theme";
import { useAuthStore } from "../stores/authStore";

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
 * ── What goes in here rather than on a tab ───────────────────────────
 *
 * The tabs are the five things somebody does over and over: browse, browse,
 * basket, orders, account. Everything ELSE that has a screen goes here —
 * addresses, favourites, help, settings — so that the tab bar never has to
 * grow a sixth item and none of these screens is reachable only by remembering
 * it exists.
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
  hint?: string;
  route: string;
  params?: object;
  /** A link that only means something once there is an account behind it. */
  needsAccount?: boolean;
}

const SHOPPING: Link[] = [
  { icon: Receipt, label: "My orders", hint: "Everything you have ordered", route: "OrdersTab", needsAccount: true },
  { icon: Heart, label: "Favourites", hint: "Shops you saved", route: "Favorites", needsAccount: true },
  { icon: MapPin, label: "My addresses", hint: "Where we deliver", route: "Addresses", needsAccount: true },
  { icon: CalendarClock, label: "Reservations", route: "Reservations", needsAccount: true },
];

const APP: Link[] = [
  { icon: UserRound, label: "Profile", hint: "Your name and contact details", route: "Profile", needsAccount: true },
  { icon: Bell, label: "Notifications", route: "Notifications", needsAccount: true },
  { icon: LifeBuoy, label: "Help centre", hint: "How ordering works", route: "Help" },
  { icon: Settings, label: "Settings", hint: "Appearance and about", route: "Settings" },
];

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
  const go = (link: Link) => {
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
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: x }],
            },
          ]}
        >
          {/*
            Who you are, in the brand's own colour.

            It was an ink block, which is the tab bar's colour and nothing
            else's — the panel read as a second navigation bar stood on its
            end. Brand at the top says this is the app's own drawer, and gives
            the white avatar something to be bright against.
          */}
          <View style={styles.who}>
            <View style={styles.avatar}>
              {signedIn && user?.name ? (
                <Text style={styles.avatarText}>{user.name.trim().charAt(0).toUpperCase()}</Text>
              ) : (
                <UserRound size={26} color={c.primary} strokeWidth={2.2} />
              )}
            </View>
            <Text style={styles.whoName} numberOfLines={1}>
              {signedIn ? (user?.name ?? "Your account") : "Welcome"}
            </Text>
            <Text style={styles.whoSub} numberOfLines={1}>
              {signedIn
                ? (user?.email ?? user?.phone ?? "Signed in")
                : "Sign in to order and follow deliveries"}
            </Text>
            <Pressable
              style={styles.whoCta}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                navigation.navigate(signedIn ? "Profile" : "SignIn");
              }}
            >
              <Text style={styles.whoCtaText}>{signedIn ? "View profile" : "Sign in"}</Text>
              <ChevronRight size={14} color={c.primary} strokeWidth={2.6} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
            <Group title="Shopping">
              {SHOPPING.map((l) => (
                <Row key={l.label} link={l} onPress={() => go(l)} />
              ))}
            </Group>

            <Group title="App">
              {APP.map((l) => (
                <Row key={l.label} link={l} onPress={() => go(l)} />
              ))}
            </Group>

            {signedIn && (
              <Pressable style={styles.signOut} accessibilityRole="button" onPress={signOut}>
                <LogOut size={18} color={c.error} strokeWidth={2.2} />
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
            )}
          </ScrollView>

          <Text style={styles.brand}>{BRAND.name}</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ link, onPress }: { link: Link; onPress: () => void }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const Icon = link.icon;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={link.label}
      onPress={onPress}
    >
      <View style={styles.rowIcon}>
        <Icon size={18} color={c.primary} strokeWidth={2.2} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{link.label}</Text>
        {!!link.hint && <Text style={styles.rowHint}>{link.hint}</Text>}
      </View>
      <ChevronRight size={16} color={c.textMuted} strokeWidth={2.2} />
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
      backgroundColor: c.surface,
      borderTopRightRadius: radius.xl,
      borderBottomRightRadius: radius.xl,
      overflow: "hidden",
    },

    who: {
      backgroundColor: c.primary,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
      gap: 2,
    },
    avatar: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: c.onPrimary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    avatarText: { ...typography.title, color: c.primary, fontSize: 23 },
    whoName: { ...typography.h3, color: c.onPrimary, fontSize: 18 },
    whoSub: { ...typography.tiny, color: c.brand[100] },
    whoCta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      alignSelf: "flex-start",
      marginTop: spacing.sm,
      backgroundColor: c.onPrimary,
      borderRadius: radius.full,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    whoCtaText: { ...typography.tiny, color: c.primary, fontWeight: "800" },

    scroll: { flexShrink: 1 },
    list: { paddingBottom: spacing.md },

    group: { marginTop: spacing.md },
    groupTitle: {
      ...typography.tiny,
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      paddingHorizontal: spacing.md,
      marginBottom: 6,
    },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 11,
    },
    rowPressed: { backgroundColor: c.surfaceAlt },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: radius.sm,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    rowCopy: { flex: 1 },
    rowLabel: { ...typography.body, color: c.text, fontSize: 14.5, fontWeight: "500" },
    rowHint: { ...typography.tiny, color: c.textMuted, marginTop: 1 },

    signOut: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.lg,
      marginHorizontal: spacing.md,
      paddingVertical: 12,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: "center",
    },
    signOutText: { ...typography.label, color: c.error, fontSize: 14 },

    brand: {
      ...typography.tiny,
      color: c.textMuted,
      textAlign: "center",
      paddingVertical: spacing.sm,
    },
  });
