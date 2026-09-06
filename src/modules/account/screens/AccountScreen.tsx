import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  Banknote,
  Bell,
  Bike,
  CalendarClock,
  ChevronRight,
  Heart,
  Info,
  LifeBuoy,
  LogOut,
  MapPin,
  Palette,
  Receipt,
  Settings as SettingsIcon,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { Touchable } from "../../../common/ui/Touchable";
import { AppButton } from "../../../common/ui/AppButton";
import { confirm } from "../../../common/ui/confirm";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import { useLogout } from "../../auth/hooks/useAuth";
import { useRiderProfile } from "../../rider/hooks/useRider";
import { BRAND } from "../../../common/brand";

/**
 * The Account tab.
 *
 * ── What changed, and why the shape is worth stating ─────────────────
 *
 * It used to be a name, a phone number, and a flat list of four links. Which
 * is honest but says nothing about what matters: the three things anybody
 * opens this tab for — an order, a saved shop, an address — sat in the same
 * type and the same row height as "Notifications".
 *
 * So: WHO you are at the top, with the one control that edits it; then those
 * three as tiles you can hit without reading; then everything else as a list,
 * because everything else genuinely is a list.
 *
 * ── Guests get the same tab ──────────────────────────────────────────
 *
 * Not a redirect to sign-in. A guest may browse the whole app and is asked for
 * an account only where an order needs one — this tab explains what signing in
 * buys rather than demanding it.
 */

interface Link {
  icon: LucideIcon;
  label: string;
  hint?: string;
  route: string;
}

/**
 * ── WHAT BELONGS ON THIS PAGE, AND WHAT WOULD BE A LIE ───────────────
 *
 * The complaint was that there was too little here — three links, none of them
 * about the account itself, and no way to change a password from the phone at
 * all. The API had answered that since the first release; the screen was the
 * missing half.
 *
 * So the page is grouped the way somebody looks for things — who I am, what I
 * have ordered, how the app behaves, what this app IS — rather than as one
 * list of everything.
 *
 * What is deliberately NOT here, because the thing behind it does not exist:
 * terms and privacy (there is no page at either address, and a row that opens
 * a 404 is worse than no row), rate the app (no store listing yet), and a
 * language picker with one language in it. Each arrives with the thing it
 * points at. A row is a promise, and a row that changes nothing is a promise
 * broken silently.
 */
const ME: Link[] = [
  { icon: UserRound, label: "Profile", hint: "Name, email and phone", route: "Profile" },
  {
    icon: ShieldCheck,
    label: "Security",
    hint: "Password and the devices signed in",
    route: "Security",
  },
  { icon: Bell, label: "Notifications", hint: "Order updates and offers", route: "Notifications" },
];

const ORDERING: Link[] = [
  { icon: CalendarClock, label: "Reservations", hint: "Tables you have booked", route: "Reservations" },
];

const APP: Link[] = [
  { icon: Palette, label: "Appearance", hint: "Light, dark or follow the phone", route: "Settings" },
  {
    icon: LifeBuoy,
    label: "Help centre",
    hint: "How ordering, payment and cancelling work",
    route: "Help",
  },
];

export function AccountScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const signOut = useLogout();
  const signedIn = status === "authenticated";
  // Only ever asked for while signed in — the hook fences itself.
  const rider = useRiderProfile();
  const riderStatus = rider.data?.status ?? null;

  const askSignOut = () => {
    confirm
      .ask({
        title: "Sign out?",
        message: "Your basket stays on this phone.",
        confirmLabel: "Sign out",
        cancelLabel: "Stay",
        tone: "danger",
      })
      .then((yes) => {
        if (yes) signOut.mutate();
      })
      .catch(() => {});
  };

  /** A tile's destination, or the sign-in wall if it needs an account. */
  const open = (route: string, params?: object) => {
    if (!signedIn) {
      navigation.navigate("SignIn");
      return;
    }
    navigation.navigate(route, params);
  };

  return (
    /*
      ── A BRAND BLOCK, AND A SHEET THAT SITS OVER IT ──────────────────

      The page was white cards on grey from the first pixel: correct, and
      completely flat. The one screen that is ABOUT somebody had no more
      presence than a settings list.

      So the top is a block of brand colour carrying the name, and the content
      begins on a rounded sheet that overlaps it — the shape every food app of
      this kind uses, for the reason they use it: it gives the page a top, and
      it puts the three things people came for on the fold.

      `edges={["top"]}` because the tab bar owns the bottom inset.
    */
    <SafeScreen backgroundColor={c.primary} edges={["top"]}>
      <FocusedStatusBar style="light-content" background={c.primary} />

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Text style={styles.heroTitle}>Account</Text>
          <Touchable
            style={styles.gear}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => navigation.navigate("Settings")}
          >
            <SettingsIcon size={19} color={c.onPrimary} strokeWidth={2.2} />
          </Touchable>
        </View>

        <Touchable
          style={styles.who}
          accessibilityRole="button"
          accessibilityLabel={signedIn ? "View profile" : "Sign in"}
          onPress={() => navigation.navigate(signedIn ? "Profile" : "SignIn")}
        >
          <View style={styles.avatar}>
            {signedIn && user?.name ? (
              <Text style={styles.avatarText}>{user.name.trim().charAt(0).toUpperCase()}</Text>
            ) : (
              <UserRound size={26} color={c.primary} strokeWidth={2.2} />
            )}
          </View>
          <View style={styles.whoCopy}>
            <Text style={styles.whoName} numberOfLines={1}>
              {signedIn ? (user?.name ?? "Your account") : "Browsing as a guest"}
            </Text>
            <Text style={styles.whoSub} numberOfLines={1}>
              {signedIn
                ? (user?.email ?? user?.phone ?? "Signed in")
                : "Sign in to order and follow deliveries"}
            </Text>
          </View>
          {signedIn ? (
            <View style={styles.editPill}>
              <Text style={styles.editText}>Edit</Text>
            </View>
          ) : (
            <ChevronRight size={18} color={c.onPrimary} strokeWidth={2.4} />
          )}
        </Touchable>
      </View>

      <ScrollView
        style={styles.sheet}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
      >
        {/*
          THE THREE REASONS ANYBODY OPENS THIS TAB, on the fold and raised off
          the sheet so they read as buttons rather than as the first row of a
          list.
        */}
        <View style={styles.tiles}>
          <Tile icon={Receipt} label="Orders" onPress={() => open("OrdersTab")} />
          <Tile icon={Heart} label="Favourites" onPress={() => open("Favorites")} />
          <Tile icon={MapPin} label="Addresses" onPress={() => open("Addresses")} />
        </View>

        {!signedIn && (
          <AppButton
            title="Sign in"
            onPress={() => navigation.navigate("SignIn")}
            style={styles.signIn}
          />
        )}

        <Text style={styles.section}>My account</Text>
        <View style={styles.card}>
          {ME.map((l, i) => (
            <Row key={l.label} link={l} divided={i > 0} onPress={() => open(l.route)} />
          ))}
        </View>

        <Text style={styles.section}>Ordering</Text>
        <View style={styles.card}>
          {ORDERING.map((l, i) => (
            <Row key={l.label} link={l} divided={i > 0} onPress={() => open(l.route)} />
          ))}
          {/*
            A VALUE, not a link. There is one way to pay and no screen behind
            it — a chevron here would open a page saying the same six words,
            and a row that opens nothing is why people stop trusting the rest.
          */}
          <ValueRow icon={Banknote} label="Payment" value="Cash on delivery" divided />
        </View>

        {/*
          ── EARNING, RATHER THAN SPENDING ─────────────────────────────

          The one row on this page that is not about an order. Where it leads
          follows what the server already decided: somebody approved goes to
          their board, somebody part-way through goes back to the form they
          left, and somebody who has never asked is invited.
        */}
        <Text style={styles.section}>Earn with us</Text>
        <View style={styles.card}>
          <Row
            link={{
              icon: Bike,
              label: riderStatus === "approved" ? "Rider mode" : "Deliver with " + BRAND.name,
              hint:
                riderStatus === "approved"
                  ? "Go on shift and take deliveries"
                  : riderStatus === "pending"
                    ? "Your application is being checked"
                    : riderStatus === "rejected"
                      ? "Your application was not accepted"
                      : "Earn on your own bike, on your own hours",
              route: riderStatus === "approved" ? "RiderHome" : "RiderApply",
            }}
            divided={false}
            onPress={() => open(riderStatus === "approved" ? "RiderHome" : "RiderApply")}
          />
        </View>

        <Text style={styles.section}>App</Text>
        <View style={styles.card}>
          {APP.map((l, i) => (
            <Row key={l.label} link={l} divided={i > 0} onPress={() => navigation.navigate(l.route)} />
          ))}
          {/*
            Not gated behind sign-in, unlike everything above it. Appearance
            and help are the two things a guest is most likely to want, and
            bouncing them to a sign-in form for either is the app refusing to
            explain itself to somebody deciding whether to join.
          */}
          <ValueRow icon={Info} label="Version" value={BRAND.version} divided />
        </View>

        {signedIn && (
          <Touchable
            style={styles.signOut}
            accessibilityRole="button"
            accessibilityLabel="Log out"
            onPress={askSignOut}
          >
            <LogOut size={17} color={c.error} strokeWidth={2.2} />
            <Text style={styles.signOutText}>
              {signOut.isPending ? "Signing out…" : "Log out"}
            </Text>
          </Touchable>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

function Tile({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <View style={styles.tileIcon}>
        <Icon size={20} color={c.primary} strokeWidth={2.1} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * A FACT, not a door.
 *
 * Same height and same type as `Row` so the card still reads as one list —
 * what it does NOT have is a chevron, because there is nothing behind it. The
 * chevron is the promise; leaving it off is the whole point.
 */
function ValueRow({
  icon: Icon,
  label,
  value,
  divided,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  divided: boolean;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <View style={[styles.row, divided && styles.rowDivided]}>
      <View style={styles.rowIcon}>
        <Icon size={17} color={c.textSecondary} strokeWidth={2.1} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Row({
  link,
  divided,
  onPress,
}: {
  link: Link;
  divided: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const Icon = link.icon;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, divided && styles.rowDivided, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={link.label}
      onPress={onPress}
    >
      {/*
        A PLATE UNDER EVERY GLYPH.

        Nineteen points of grey outline floating on white is what made this
        page read as a settings list from 2013 — the icons were the same
        weight as the dividers and carried no more emphasis. A soft square
        behind each one gives the column an edge to line up on and the row
        something to start with, which is the shape the Settings screen was
        already using two taps away.
      */}
      <View style={styles.rowIcon}>
        <Icon size={17} color={c.textSecondary} strokeWidth={2.1} />
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
    /**
     * THE BLOCK THE PAGE STANDS ON.
     *
     * This screen was white cards on grey from the first pixel — correct, and
     * completely flat. The one page that is ABOUT somebody had no more
     * presence than a settings list.
     *
     * The content below begins on a rounded sheet that OVERLAPS this. The
     * overlap is a negative margin on the sheet rather than a positive one
     * here, so the hero keeps its own height whatever the sheet does.
     */
    hero: {
      backgroundColor: c.primary,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.xl,
    },
    heroTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.md,
    },
    heroTitle: { ...typography.title, color: c.onPrimary, fontSize: 21 },
    gear: {
      width: 36,
      height: 36,
      borderRadius: 18,
      // A wash of the same white the text is, rather than a second colour.
      // One tint keeps the block reading as one object.
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
      justifyContent: "center",
    },

    sheet: {
      flex: 1,
      backgroundColor: c.bg,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      marginTop: -18,
    },
    body: { padding: spacing.md, paddingBottom: spacing.xl },

    who: { flexDirection: "row", alignItems: "center", gap: 12 },
    avatar: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: c.onPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { ...typography.title, color: c.primary, fontSize: 23 },
    whoCopy: { flex: 1, gap: 2 },
    whoName: { ...typography.h3, color: c.onPrimary, fontSize: 18 },
    whoSub: { ...typography.tiny, color: c.brand[100] },
    editPill: {
      backgroundColor: "rgba(255,255,255,0.22)",
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    editText: { ...typography.tiny, color: c.onPrimary, fontWeight: "800" },

    signIn: { marginTop: spacing.md },

    // Raised onto the sheet's top edge, so the three things people came for
    // read as buttons rather than as the first row of a list.
    tiles: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
    tile: {
      flex: 1,
      alignItems: "center",
      gap: 7,
      paddingVertical: spacing.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
    },
    tileIcon: {
      width: 38,
      height: 38,
      borderRadius: 13,
      backgroundColor: c.brand[50],
      alignItems: "center",
      justifyContent: "center",
    },
    tilePressed: { backgroundColor: c.surfaceAlt },
    tileLabel: { ...typography.small, color: c.text, fontWeight: "600" },

    section: {
      ...typography.tiny,
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: 11,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    rowDivided: { borderTopWidth: 1, borderTopColor: c.border },
    rowPressed: { backgroundColor: c.surfaceAlt },
    rowCopy: { flex: 1 },
    rowLabel: { ...typography.body, color: c.text, fontSize: 14.5, fontWeight: "500" },
    rowHint: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
    rowValue: { ...typography.small, color: c.textSecondary, fontWeight: "600" },

    signOut: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      marginTop: spacing.lg,
      paddingVertical: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    signOutPressed: { backgroundColor: c.surfaceAlt },
    signOutText: { ...typography.label, color: c.error, fontSize: 14 },
  });
