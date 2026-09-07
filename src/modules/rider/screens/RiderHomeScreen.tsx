import React from "react";
import {
  Animated,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  BanknoteIcon,
  BoxIcon,
  ChevronRightIcon,
  MapPinIcon,
  MenuIcon,
  MotorcycleIcon,
  ParcelIcon,
  StorefrontIcon,
  WalletIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { EmptyState } from "../../../common/ui/EmptyState";
import { Touchable } from "../../../common/ui/Touchable";
import { SideMenu } from "../../../navigation/SideMenu";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { RefreshPill } from "../../../common/ui/RefreshPill";
import { toast } from "../../../common/ui/toast";
import { money } from "../../../common/format";
import { BRAND } from "../../../common/brand";
import { formatDistance } from "../../marketplace/shopFacts";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { askForLocation, currentPosition } from "../../../services/position";
import { useRiderActions, useRiderBoard, useRiderProfile } from "../hooks/useRider";
import { riderService, type RiderJob } from "../services/riderService";

/**
 * A rider's shift.
 *
 * ── One screen, one call ─────────────────────────────────────────────
 *
 * Duty state, current jobs, the board and today's money all come from
 * `/rider/board`. A phone on a patchy connection asking four endpoints renders
 * a screen assembled from four different moments — a switch that says offline
 * above a job list that says otherwise.
 *
 * ── The heartbeat ────────────────────────────────────────────────────
 *
 * Being "online" is a claim that has to keep being true. The server treats a
 * rider whose phone stopped reporting as unavailable after five minutes, so
 * this pings while the screen is open and stops the moment it is not — which
 * is also what stops a rider appearing on a job board from inside their pocket.
 */

const PING_MS = 45_000;

export function RiderHomeScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  // The board is a root tab in rider mode, so the left slot is the way into
  // the menu — which is where the switch back to shopping lives.
  const [menu, setMenu] = React.useState(false);

  const rider = useRiderProfile();
  const approved = rider.data?.status === "approved";
  const board = useRiderBoard(approved);
  const { setOnline } = useRiderActions();
  const pull = usePullToRefresh(board.refetch);

  const online = board.data?.is_online ?? rider.data?.is_online ?? false;

  // Heartbeat — only while online AND only while this screen is mounted.
  React.useEffect(() => {
    if (!online) return;
    let alive = true;
    const beat = async () => {
      const fix = await currentPosition({ highAccuracy: true, timeoutMs: 8000 });
      if (!alive || fix == null) return;
      // Fire and forget: a missed heartbeat is corrected by the next one, and
      // a toast every time a rider goes under a bridge is noise.
      riderService.ping(fix).catch(() => {});
    };
    beat();
    const id = setInterval(beat, PING_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [online]);

  const toggle = async () => {
    if (!online) {
      const allowed = await askForLocation("needs your location to send you deliveries near you.");
      if (!allowed) {
        toast.error("Allow location to go online.");
        return;
      }
      const fix = await currentPosition({ highAccuracy: true });
      if (fix == null) {
        toast.error("Could not find your location. Check that GPS is on.");
        return;
      }
      setOnline.mutate({ is_online: true, at: fix });
      return;
    }
    setOnline.mutate({ is_online: false });
  };

  // ── Not a rider yet, or not approved ────────────────────────────────
  if (rider.isSuccess && !approved) {
    return (
      <SafeScreen edges={["top", "bottom"]}>
        <ScreenHeader title="Rider" onMenu={() => setMenu(true)} />
        <SideMenu visible={menu} onClose={() => setMenu(false)} />
        <View style={styles.gate}>
          <View style={styles.gateIcon}>
            <MotorcycleIcon size={30} color={c.primary} />
          </View>
          <Text style={styles.gateTitle}>
            {rider.data == null ? "You are not a rider yet" : rider.data.status_label}
          </Text>
          <Text style={styles.gateBody}>
            {rider.data == null
              ? "Apply once, get approved, then go online whenever you want to work."
              : (rider.data.review_note ?? "Open your application to see what is left.")}
          </Text>
          <Touchable
            style={styles.gateCta}
            accessibilityRole="button"
            onPress={() => navigation.navigate("RiderApply")}
          >
            <Text style={styles.gateCtaText}>
              {rider.data == null ? "Become a rider" : "Open application"}
            </Text>
            <ChevronRightIcon size={15} color={c.onPrimary} />
          </Touchable>
        </View>
      </SafeScreen>
    );
  }

  if (board.isError) {
    return (
      <SafeScreen edges={["top", "bottom"]}>
        <ScreenHeader title="Rider" onMenu={() => setMenu(true)} />
        <SideMenu visible={menu} onClose={() => setMenu(false)} />
        <LoadFailed
          what="your deliveries"
          error={board.error}
          onRetry={() => board.refetch()}
          retrying={board.isFetching}
        />
      </SafeScreen>
    );
  }

  const active = board.data?.active ?? [];
  const offers = board.data?.offers ?? [];
  const today = board.data?.earnings_today;

  return (
    /**
     * PAINTED TO THE TOP, like the shopping side.
     *
     * The board wore a plain `ScreenHeader` — a white bar with the word
     * "Rider" on it — while the customer home opens on a full-width coloured
     * hero. Two halves of one app that did not look related, and the working
     * half was the one that looked unfinished.
     *
     * `edges` drops "top" because the hero paints under the status bar itself.
     */
    <SafeScreen backgroundColor={c.brand[600]} edges={["bottom"]}>
      <FocusedStatusBar style="light-content" background={c.brand[600]} />
      <SideMenu visible={menu} onClose={() => setMenu(false)} />

      <FlatList
        data={offers}
        keyExtractor={(j) => j.id}
        contentContainerStyle={[styles.list, styles.listGrow]}
        refreshControl={
          // The spinner belongs to the GESTURE, not to any refetch. This
          // screen polls every fifteen seconds — bound to `isRefetching` the
          // indicator would appear on its own four times a minute, over
          // whatever the rider had scrolled to.
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.primary} />
        }
        ListHeaderComponent={
          <>
            {/* ── The hero ──────────────────────────────────────────── */}
            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <Touchable
                  style={styles.burger}
                  onPress={() => setMenu(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Menu"
                >
                  <MenuIcon size={21} color={c.white} />
                </Touchable>

                {/*
                  THE BRANDING, which was nowhere on this half of the app.

                  The shopping side opens on "Hi <name>" and never needs to say
                  what it is — somebody who just tapped the icon knows. The
                  rider side is entered by SWITCHING MODE from inside the same
                  app, so the one thing it has to answer is "am I in the right
                  place": same product, working side. Hence the lockup rather
                  than a title.

                  `BRAND.name`, never the literal — see `brand.ts`.
                */}
                <View style={styles.lockup}>
                  <Text style={styles.wordmark}>{BRAND.name}</Text>
                  <View style={styles.modeChip}>
                    <Text style={styles.modeChipText}>RIDER</Text>
                  </View>
                </View>

                <View style={styles.grow} />

                <RefreshPill
                  at={board.data?.as_of}
                  busy={board.isFetching}
                  onPress={() => board.refetch()}
                  onDark
                />
              </View>

              {/*
                ── ON DUTY, as the headline ──────────────────────────

                This was a bordered card below the header, the same size and
                weight as the three stat tiles under it — so the one control
                that decides whether the whole screen does anything looked like
                a row in a list.

                It is the hero now: the biggest words on the screen say whether
                work can reach you, and the switch is beside them.
              */}
              <Touchable
                style={styles.duty}
                accessibilityRole="switch"
                accessibilityState={{ checked: online }}
                accessibilityLabel={online ? "Go offline" : "Go online"}
                onPress={toggle}
                disabled={setOnline.isPending}
              >
                <View style={styles.dutyCopy}>
                  <View style={styles.dutyTitleRow}>
                    {/*
                      A dot, not just a colour change. Colour alone is never an
                      accessible cue, and this is the screen's whole state.
                    */}
                    <View style={[styles.dutyDot, online && styles.dutyDotOn]} />
                    <Text style={styles.dutyTitle}>
                      {online ? "You are online" : "You are offline"}
                    </Text>
                  </View>
                  <Text style={styles.dutyHint} numberOfLines={2}>
                    {setOnline.isPending
                      ? "One moment…"
                      : online
                        ? "Shops near you can send you deliveries"
                        : "Tap to start taking deliveries"}
                  </Text>
                </View>
                <Knob on={online} />
              </Touchable>

              {/* The id a shop types to add you. Small, and always there —
                  it is asked for on a phone call, which is a bad moment to go
                  looking through a menu for it. */}
              {!!rider.data?.rider_code && (
                <Text style={styles.riderCode}>{rider.data.rider_code}</Text>
              )}
            </View>

            {/*
              ── Today ─────────────────────────────────────────────────

              Lifted onto the hero's bottom edge. Three grey tiles floating in
              the page read as filters; one card straddling the colour reads as
              a summary of the band above it, which is what it is.
            */}
            <View style={styles.stats}>
              <Stat icon={BoxIcon} label="Delivered" value={String(today?.deliveries ?? 0)} />
              <View style={styles.statDivide} />
              <Stat icon={WalletIcon} label="Earned" value={money(today?.earned ?? 0)} />
              <View style={styles.statDivide} />
              <Touchable
                style={styles.statPress}
                accessibilityRole="button"
                accessibilityLabel="Cash in hand"
                onPress={() => navigation.navigate("RiderEarnings")}
              >
                <Stat
                  icon={BanknoteIcon}
                  label="Cash in hand"
                  value={money(today?.cash_in_hand ?? 0)}
                  warn={(today?.cash_in_hand ?? 0) > 0}
                />
              </Touchable>
            </View>

            {/* ── Carrying now ──────────────────────────────────────── */}
            {active.length > 0 && (
              <>
                <Text style={[styles.caption, styles.inset]}>Carrying now</Text>
                <View style={[styles.inset, styles.stack]}>
                  {active.map((j) => (
                    <JobCard
                      key={j.id}
                      job={j}
                      mine
                      onPress={() => navigation.navigate("RiderJob", { id: j.id })}
                    />
                  ))}
                </View>
              </>
            )}

            <Text style={[styles.caption, styles.inset]}>
              {offers.length > 0 ? "Available now" : online ? "Nothing right now" : "Offers"}
            </Text>
          </>
        }
        ListEmptyComponent={
          <EmptyState
            icon={ParcelIcon}
            tone={online ? "muted" : "warm"}
            title={
              !online
                ? "Go online to see work"
                : active.length >= (board.data?.job_limit ?? 3)
                  ? "You are at your limit"
                  : "No deliveries near you"
            }
            message={
              !online
                ? "Nothing is offered to a rider who is off duty."
                : active.length >= (board.data?.job_limit ?? 3)
                  ? `Deliver one of your ${active.length} orders and the board opens again.`
                  : "A job is offered to the riders nearest the shop first, then wider. This checks again every few seconds."
            }
          />
        }
        renderItem={({ item }) => (
          <View style={styles.inset}>
            <JobCard job={item} onPress={() => navigation.navigate("RiderJob", { id: item.id })} />
          </View>
        )}
      />
    </SafeScreen>
  );
}

/**
 * The duty switch's knob.
 *
 * Hand-drawn rather than RN's `Switch`, which on Android is a platform widget
 * that ignores `trackColor` on some versions — and this control is the whole
 * screen's state, so it has to look like the brand said it should.
 */
function Knob({ on }: { on: boolean }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const x = React.useRef(new Animated.Value(on ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.spring(x, {
      toValue: on ? 1 : 0,
      damping: 16,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  }, [on, x]);

  return (
    <View style={[styles.track, on && styles.trackOn]}>
      <Animated.View
        style={[
          styles.knob,
          { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 24] }) }] },
        ]}
      />
    </View>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  warn,
}: {
  icon: typeof BoxIcon;
  label: string;
  value: string;
  warn?: boolean;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.stat}>
      <Icon size={16} color={warn ? c.warning : c.textMuted} />
      <Text style={[styles.statValue, warn && styles.statValueWarn]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * One job.
 *
 * `mine` is not decoration: an offer and a job in hand are different payloads
 * — the offer has no address on it at all — so the card must not reach for a
 * field that is only there after accepting.
 */
export function JobCard({ job, onPress, mine }: { job: RiderJob; onPress: () => void; mine?: boolean }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const stageLabel =
    job.stage === "on_the_way" ? "On the way" : job.stage === "to_pickup" ? "Collect it" : null;

  return (
    <Touchable
      style={[styles.job, mine && styles.jobMine]}
      accessibilityRole="button"
      accessibilityLabel={`Order ${job.order_number}`}
      onPress={onPress}
    >
      <View style={styles.jobTop}>
        <Text style={styles.jobFee}>{money(job.delivery_fee)}</Text>
        {stageLabel != null && (
          <View style={styles.stagePill}>
            <Text style={styles.stageText}>{stageLabel}</Text>
          </View>
        )}
        <View style={styles.grow} />
        {job.pickup_distance_km != null && (
          // The SHARED formatter, not a raw number with " km" after it.
          // Printing `distance_km` by hand was copied five times on the
          // shopping side and every copy said "945.81 km".
          <Text style={styles.jobKm}>{formatDistance(job.pickup_distance_km)} away</Text>
        )}
      </View>

      <View style={styles.leg}>
        <StorefrontIcon size={15} color={c.primary} />
        <Text style={styles.legText} numberOfLines={1}>
          {job.shop.name}
          {job.shop.branch ? ` · ${job.shop.branch}` : ""}
        </Text>
      </View>
      <View style={styles.leg}>
        <MapPinIcon size={15} color={c.textMuted} />
        <Text style={styles.legText} numberOfLines={1}>
          {job.delivery_address ?? job.drop_area ?? "Nearby"}
        </Text>
      </View>

      <View style={styles.jobFoot}>
        <Text style={styles.jobMeta}>
          {job.items_count ?? 0} item{(job.items_count ?? 0) === 1 ? "" : "s"}
          {job.drop_distance_km != null ? ` · ${formatDistance(job.drop_distance_km)} drop` : ""}
        </Text>
        {job.cash_to_collect > 0 && (
          <View style={styles.cashPill}>
            <BanknoteIcon size={12} color={c.onWarm} />
            <Text style={styles.cashText}>Collect {money(job.cash_to_collect)}</Text>
          </View>
        )}
      </View>
    </Touchable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    /**
     * NO HORIZONTAL PADDING ON THE LIST.
     *
     * The hero has to reach both edges of the screen, and it is inside
     * `ListHeaderComponent` — so the inset moved onto the rows and onto the
     * hero's own contents instead.
     */
    list: { paddingBottom: spacing.xxl, gap: spacing.xs },
    /** So `ListEmptyComponent` has a screen to centre in. */
    listGrow: { flexGrow: 1 },
    /** Everything below the hero keeps the page's own margin. */
    inset: { paddingHorizontal: spacing.md },
    /** The gap the list's own `gap` used to give the "carrying now" group. */
    stack: { gap: spacing.xs },

    // ── The hero ───────────────────────────────────────────────────
    /**
     * The working side's own band.
     *
     * `brand[600]` rather than `500`: this palette is the ember one in rider
     * mode, and the deeper step is what keeps white text at a comfortable
     * contrast on orange — the same tone the account page's "Deliver with
     * CartZe" door uses, so the two agree.
     *
     * Bottom corners only, and `paddingBottom` leaves room for the stats card
     * to sit ON the edge rather than under it.
     */
    hero: {
      backgroundColor: c.brand[600],
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: 44,
      borderBottomLeftRadius: radius.xl,
      borderBottomRightRadius: radius.xl,
    },
    heroTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    burger: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      backgroundColor: "rgba(255,255,255,0.16)",
      alignItems: "center",
      justifyContent: "center",
    },

    lockup: { flexDirection: "row", alignItems: "center", gap: 7 },
    wordmark: { ...typography.display, fontSize: 20, color: c.white, letterSpacing: -0.4 },
    /**
     * "RIDER" as a chip, not as a second word.
     *
     * The mode is a qualifier on the product name, and setting it in the same
     * type would read as a two-word product. A chip says "same app, this
     * side".
     */
    modeChip: {
      backgroundColor: "rgba(255,255,255,0.2)",
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 6,
    },
    modeChipText: {
      ...typography.tiny,
      color: c.white,
      fontSize: 9.5,
      fontWeight: "800",
      letterSpacing: 0.8,
    },

    /**
     * The duty row, on the colour.
     *
     * A translucent white rather than `c.surface`: a solid card here would
     * punch a hole in the band and look like the old layout with a coloured
     * strip behind it.
     */
    duty: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: "rgba(255,255,255,0.14)",
      borderRadius: radius.lg,
      paddingVertical: 14,
      paddingHorizontal: spacing.md,
      marginTop: spacing.md,
    },
    dutyCopy: { flex: 1, gap: 3 },
    dutyTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    /**
     * Off is a hollow ring, on is filled.
     *
     * Not two colours: on a coloured ground a red dot and a green dot at 8px
     * are the same dot to most eyes, and colour alone is never the only cue.
     */
    dutyDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: "rgba(255,255,255,0.55)",
    },
    /**
     * A LITERAL white, not `c.white`.
     *
     * `darkModeDebt` bans `backgroundColor: c.white` outright and is right to:
     * the token is literal white in both themes, so it reads as theme-aware
     * and paints a white card on a dark page. There is no exemption list, and
     * adding one to a rule that currently holds absolutely would cost more
     * than these two lines are worth.
     *
     * Both of these sit on the ember band, which is ember in either theme —
     * so the pigment is genuinely fixed, and saying so with a literal is the
     * honest spelling. Same reason `PromoCarousel`'s scrim text is "#ffffff".
     */
    dutyDotOn: { backgroundColor: "#ffffff", borderColor: "#ffffff" },
    dutyTitle: { ...typography.h3, color: c.white, fontSize: 17 },
    dutyHint: { ...typography.tiny, color: "rgba(255,255,255,0.82)" },

    /** The code a shop types to add this rider. Quiet, and never absent. */
    riderCode: {
      ...typography.tiny,
      color: "rgba(255,255,255,0.7)",
      fontWeight: "700",
      letterSpacing: 0.6,
      marginTop: spacing.sm,
      textAlign: "center",
    },

    track: {
      width: 52,
      height: 30,
      borderRadius: 15,
      backgroundColor: "rgba(0,0,0,0.22)",
      padding: 3,
      justifyContent: "center",
    },
    trackOn: { backgroundColor: "rgba(255,255,255,0.3)" },
    // Literal, and on the ember band in both themes — see `dutyDotOn`.
    knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#ffffff" },

    // ── Today ──────────────────────────────────────────────────────
    /**
     * ONE card straddling the hero's edge, not three tiles in the page.
     *
     * `marginTop` is negative by design: the overlap is what ties the numbers
     * to the band above them. Three separate bordered tiles floating below it
     * read as filters, which is what they looked like.
     */
    stats: {
      flexDirection: "row",
      alignItems: "stretch",
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      marginHorizontal: spacing.md,
      marginTop: -32,
      paddingVertical: 12,
    },
    statPress: { flex: 1 },
    /** A hairline between the columns, so three numbers read as three. */
    statDivide: { width: 1, backgroundColor: c.border, marginVertical: 4 },
    stat: { flex: 1, alignItems: "center", gap: 4, paddingHorizontal: 6 },
    statValue: { ...typography.label, color: c.text, fontSize: 15 },
    statValueWarn: { color: c.warning },
    statLabel: { ...typography.tiny, color: c.textMuted, fontSize: 10.5 },

    caption: {
      ...typography.tiny,
      color: c.textMuted,
      fontWeight: "700",
      marginTop: spacing.md,
      marginBottom: 2,
    },

    job: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: 7,
    },
    jobMine: { borderColor: c.primary, borderWidth: 1.5 },
    jobTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    grow: { flex: 1 },
    jobFee: { ...typography.h3, color: c.primary, fontSize: 17 },
    jobKm: { ...typography.tiny, color: c.textMuted },
    stagePill: {
      backgroundColor: c.primarySoft,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    stageText: { ...typography.tiny, color: c.primary, fontWeight: "800", fontSize: 10 },

    leg: { flexDirection: "row", alignItems: "center", gap: 8 },
    legText: { ...typography.small, color: c.text, flex: 1 },

    jobFoot: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      marginTop: 2,
    },
    jobMeta: { ...typography.tiny, color: c.textMuted, flex: 1 },
    cashPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: c.warmSoft,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    cashText: { ...typography.tiny, color: c.onWarm, fontWeight: "800", fontSize: 10.5 },

    gate: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: 8 },
    gateIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    gateTitle: { ...typography.h3, color: c.text, textAlign: "center" },
    gateBody: { ...typography.small, color: c.textMuted, textAlign: "center", lineHeight: 19 },
    gateCta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: c.primary,
      borderRadius: 21,
      paddingHorizontal: 18,
      paddingVertical: 11,
      marginTop: spacing.sm,
    },
    gateCtaText: { ...typography.label, color: c.onPrimary, fontSize: 14 },
  });
