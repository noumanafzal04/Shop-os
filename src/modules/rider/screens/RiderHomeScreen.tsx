import React from "react";
import {
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  Banknote,
  Bike,
  ChevronRight,
  MapPin,
  Package,
  Store,
  Wallet,
} from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { RefreshPill } from "../../../common/ui/RefreshPill";
import { toast } from "../../../common/ui/toast";
import { money } from "../../../common/format";
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
        <ScreenHeader title="Rider" />
        <View style={styles.gate}>
          <View style={styles.gateIcon}>
            <Bike size={30} color={c.primary} strokeWidth={1.8} />
          </View>
          <Text style={styles.gateTitle}>
            {rider.data == null ? "You are not a rider yet" : rider.data.status_label}
          </Text>
          <Text style={styles.gateBody}>
            {rider.data == null
              ? "Apply once, get approved, then go online whenever you want to work."
              : (rider.data.review_note ?? "Open your application to see what is left.")}
          </Text>
          <Pressable
            style={styles.gateCta}
            accessibilityRole="button"
            onPress={() => navigation.navigate("RiderApply")}
          >
            <Text style={styles.gateCtaText}>
              {rider.data == null ? "Become a rider" : "Open application"}
            </Text>
            <ChevronRight size={15} color={c.onPrimary} strokeWidth={2.6} />
          </Pressable>
        </View>
      </SafeScreen>
    );
  }

  if (board.isError) {
    return (
      <SafeScreen edges={["top", "bottom"]}>
        <ScreenHeader title="Rider" />
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
    <SafeScreen edges={["top", "bottom"]}>
      <ScreenHeader
        title="Rider"
        subtitle={rider.data?.rider_code}
        right={<RefreshPill at={board.data?.as_of} busy={board.isFetching} onPress={() => board.refetch()} />}
      />

      <FlatList
        data={offers}
        keyExtractor={(j) => j.id}
        contentContainerStyle={styles.list}
        refreshControl={
          // The spinner belongs to the GESTURE, not to any refetch. This
          // screen polls every fifteen seconds — bound to `isRefetching` the
          // indicator would appear on its own four times a minute, over
          // whatever the rider had scrolled to.
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.primary} />
        }
        ListHeaderComponent={
          <>
            {/* ── On duty ───────────────────────────────────────────── */}
            <Pressable
              style={[styles.duty, online && styles.dutyOn]}
              accessibilityRole="switch"
              accessibilityState={{ checked: online }}
              accessibilityLabel={online ? "Go offline" : "Go online"}
              onPress={toggle}
              disabled={setOnline.isPending}
            >
              <View style={styles.dutyCopy}>
                <Text style={[styles.dutyTitle, online && styles.dutyTitleOn]}>
                  {online ? "You are online" : "You are offline"}
                </Text>
                <Text style={[styles.dutyHint, online && styles.dutyHintOn]}>
                  {setOnline.isPending
                    ? "One moment…"
                    : online
                      ? "Shops near you can send you deliveries"
                      : "Tap to start taking deliveries"}
                </Text>
              </View>
              <Knob on={online} />
            </Pressable>

            {/* ── Today ─────────────────────────────────────────────── */}
            <View style={styles.stats}>
              <Stat icon={Package} label="Delivered" value={String(today?.deliveries ?? 0)} />
              <Stat icon={Wallet} label="Earned" value={money(today?.earned ?? 0)} />
              <Pressable
                style={styles.statPress}
                accessibilityRole="button"
                accessibilityLabel="Cash in hand"
                onPress={() => navigation.navigate("RiderEarnings")}
              >
                <Stat
                  icon={Banknote}
                  label="Cash in hand"
                  value={money(today?.cash_in_hand ?? 0)}
                  warn={(today?.cash_in_hand ?? 0) > 0}
                />
              </Pressable>
            </View>

            {/* ── Carrying now ──────────────────────────────────────── */}
            {active.length > 0 && (
              <>
                <Text style={styles.caption}>Carrying now</Text>
                {active.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    mine
                    onPress={() => navigation.navigate("RiderJob", { id: j.id })}
                  />
                ))}
              </>
            )}

            <Text style={styles.caption}>
              {offers.length > 0 ? "Available now" : online ? "Nothing right now" : "Offers"}
            </Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {!online
                ? "Go online to see work"
                : active.length >= (board.data?.job_limit ?? 3)
                  ? "You are at your limit"
                  : "No deliveries near you"}
            </Text>
            <Text style={styles.emptyBody}>
              {!online
                ? "Nothing is offered to a rider who is off duty."
                : active.length >= (board.data?.job_limit ?? 3)
                  ? `Deliver one of your ${active.length} orders and the board opens again.`
                  : "This page checks again every few seconds."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <JobCard job={item} onPress={() => navigation.navigate("RiderJob", { id: item.id })} />
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
  icon: typeof Package;
  label: string;
  value: string;
  warn?: boolean;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.stat}>
      <Icon size={16} color={warn ? c.warning : c.textMuted} strokeWidth={2} />
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
    <Pressable
      style={({ pressed }) => [styles.job, mine && styles.jobMine, pressed && styles.jobPressed]}
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
        <Store size={15} color={c.primary} strokeWidth={2.2} />
        <Text style={styles.legText} numberOfLines={1}>
          {job.shop.name}
          {job.shop.branch ? ` · ${job.shop.branch}` : ""}
        </Text>
      </View>
      <View style={styles.leg}>
        <MapPin size={15} color={c.textMuted} strokeWidth={2.2} />
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
            <Banknote size={12} color={c.onWarm} strokeWidth={2.4} />
            <Text style={styles.cashText}>Collect {money(job.cash_to_collect)}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    list: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.xs },

    duty: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
    },
    dutyOn: { backgroundColor: c.successBg, borderColor: c.success },
    dutyCopy: { flex: 1, gap: 2 },
    dutyTitle: { ...typography.h3, color: c.text, fontSize: 16 },
    dutyTitleOn: { color: c.success },
    dutyHint: { ...typography.tiny, color: c.textMuted },
    dutyHintOn: { color: c.textSecondary },

    track: {
      width: 52,
      height: 30,
      borderRadius: 15,
      backgroundColor: c.gray[200],
      padding: 3,
      justifyContent: "center",
    },
    trackOn: { backgroundColor: c.success },
    knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.surface },

    stats: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
    statPress: { flex: 1 },
    stat: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 11,
      paddingHorizontal: 10,
      gap: 3,
    },
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
    jobPressed: { opacity: 0.75 },
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

    empty: { alignItems: "center", paddingVertical: spacing.xl, gap: 5 },
    emptyTitle: { ...typography.h3, color: c.text, fontSize: 15.5 },
    emptyBody: { ...typography.small, color: c.textMuted, textAlign: "center" },

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
      borderRadius: radius.full,
      paddingHorizontal: 18,
      paddingVertical: 11,
      marginTop: spacing.sm,
    },
    gateCtaText: { ...typography.label, color: c.onPrimary, fontSize: 14 },
  });
