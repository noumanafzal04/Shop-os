import React from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  Banknote,
  CheckCircle2,
  Navigation,
  Phone,
  Store,
  MapPin,
} from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { AppButton } from "../../../common/ui/AppButton";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { RefreshPill } from "../../../common/ui/RefreshPill";
import { confirm } from "../../../common/ui/confirm";
import { toast } from "../../../common/ui/toast";
import { money, qtyText } from "../../../common/format";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useRiderActions, useRiderBoard } from "../hooks/useRider";
import type { RiderJob } from "../services/riderService";

/**
 * One delivery, from the rider's side.
 *
 * ── Why this reads from the board rather than its own endpoint ───────
 *
 * The board already carries every job this rider can see, offers and jobs in
 * hand alike, and it is already polling. A second endpoint would be a second
 * copy of the same rows arriving at a different moment — the classic way for a
 * detail screen to show a stage the list has already moved past.
 *
 * ── The four buttons ─────────────────────────────────────────────────
 *
 * offered    → Accept, or leave it
 * to_pickup  → Collected (and Hand back, while that is still honest)
 * on_the_way → the customer's code, then Delivered
 * delivered  → nothing; it is done
 *
 * There is exactly ONE primary button at a time. A screen offering "Collected"
 * beside "Delivered" invites the tap that skips the leg in between, and on a
 * cash order that leg is where the money is.
 */
export function RiderJobScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id: string = route.params?.id;

  const board = useRiderBoard(true);
  const { accept, decline, pickUp, deliver } = useRiderActions();
  const [code, setCode] = React.useState("");

  const job: RiderJob | undefined =
    board.data?.active.find((j) => j.id === id) ?? board.data?.offers.find((j) => j.id === id);

  const stage = job?.stage ?? "offered";

  const call = (phone?: string | null) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone.replace(/\s/g, "")}`).catch(() =>
      toast.error("This phone cannot make calls."),
    );
  };

  /**
   * Hand the coordinates to whatever maps app the phone has.
   *
   * `geo:` is the Android intent every navigation app registers for; iOS has
   * no equivalent and takes an Apple Maps URL. Neither is guaranteed to
   * resolve, so a failure says so instead of doing nothing.
   */
  const navigateTo = (lat?: number | null, lng?: number | null, label?: string) => {
    if (lat == null || lng == null) {
      toast.info("No map pin on this one — use the address.");
      return;
    }
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?daddr=${lat},${lng}`
        : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label ?? "Delivery")})`;
    Linking.openURL(url).catch(() => toast.error("No maps app on this phone."));
  };

  const onAccept = () =>
    accept
      .mutateAsync(id)
      .then(() => toast.success("It's yours — head to the shop"))
      .catch(() => {});

  const onDecline = () =>
    confirm
      .ask({
        title: "Hand this back?",
        message: "It goes back to the shop or the board for someone else.",
        confirmLabel: "Hand back",
        cancelLabel: "Keep it",
        tone: "danger",
      })
      .then((yes) => {
        if (!yes) return;
        decline
          .mutateAsync(id)
          .then(() => {
            toast.info("Handed back");
            navigation.goBack();
          })
          .catch(() => {});
      })
      .catch(() => {});

  const onPickUp = () =>
    pickUp
      .mutateAsync(id)
      .then(() => toast.success("On the way"))
      .catch(() => {});

  const onDeliver = () =>
    deliver
      .mutateAsync({ id, code: code.trim() })
      .then(() => {
        toast.success("Delivered — nice work");
        navigation.goBack();
      })
      .catch(() => {});

  // ── Gone from the board ────────────────────────────────────────────
  //
  // Delivered a second ago, or taken by somebody else while this screen was
  // open. Both are normal, and neither is an error worth a red screen.
  if (board.isSuccess && job == null) {
    return (
      <SafeScreen edges={["top", "bottom"]}>
        <ScreenHeader title="Delivery" />
        <View style={styles.gone}>
          <CheckCircle2 size={34} color={c.success} strokeWidth={1.8} />
          <Text style={styles.goneTitle}>This one is finished</Text>
          <Text style={styles.goneBody}>
            It is no longer on your board. Anything you delivered today is in your earnings.
          </Text>
          <AppButton title="Back to deliveries" onPress={() => navigation.goBack()} variant="outline" />
        </View>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen edges={["top", "bottom"]}>
      <ScreenHeader
        title={job?.order_number ?? "Delivery"}
        subtitle={job != null ? `${money(job.delivery_fee)} for this trip` : undefined}
        right={
          <RefreshPill at={board.data?.as_of} busy={board.isFetching} onPress={() => board.refetch()} compact />
        }
      />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {job != null && (
          <>
            {/* ── Collect from ───────────────────────────────────────── */}
            <Leg
              icon={Store}
              caption="Collect from"
              title={job.shop.name ?? "Shop"}
              body={[job.shop.branch, job.shop.address].filter(Boolean).join(" · ") || "Ask at the counter"}
              onCall={job.shop_phone ? () => call(job.shop_phone) : undefined}
              onNavigate={() => navigateTo(job.shop.latitude, job.shop.longitude, job.shop.name ?? "Shop")}
              done={stage === "on_the_way" || stage === "delivered"}
            />

            {/* ── Deliver to ─────────────────────────────────────────── */}
            <Leg
              icon={MapPin}
              caption="Deliver to"
              title={job.customer_name ?? job.drop_area ?? "Nearby"}
              body={
                job.delivery_address ??
                // Before accepting, the address genuinely is not in the
                // payload — see `RiderJobView` on the server.
                "Full address once you accept"
              }
              onCall={job.customer_phone ? () => call(job.customer_phone) : undefined}
              onNavigate={
                job.latitude != null ? () => navigateTo(job.latitude, job.longitude, "Delivery") : undefined
              }
              done={stage === "delivered"}
            />

            {/* ── The bag ────────────────────────────────────────────── */}
            {(job.items?.length ?? 0) > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>What you are carrying</Text>
                {job.items!.map((i, n) => (
                  <View key={`${i.product_name}-${n}`} style={styles.item}>
                    <Text style={styles.itemQty}>{qtyText(i.quantity)} ×</Text>
                    <Text style={styles.itemName} numberOfLines={2}>
                      {i.product_name}
                      {i.variant_name ? ` · ${i.variant_name}` : ""}
                      {i.unit_name ? ` · ${i.unit_name}` : ""}
                    </Text>
                  </View>
                ))}
                {!!job.notes && <Text style={styles.notes}>“{job.notes}”</Text>}
              </View>
            )}

            {/* ── The money ──────────────────────────────────────────── */}
            <View style={[styles.card, job.cash_to_collect > 0 && styles.cashCard]}>
              <View style={styles.moneyRow}>
                <Banknote size={17} color={job.cash_to_collect > 0 ? c.onWarm : c.textMuted} strokeWidth={2.2} />
                <Text style={styles.moneyLabel}>
                  {job.cash_to_collect > 0 ? "Collect from the customer" : "Already paid"}
                </Text>
                <Text style={styles.moneyValue}>
                  {job.cash_to_collect > 0 ? money(job.cash_to_collect) : money(job.order_total)}
                </Text>
              </View>
              <Text style={styles.moneyHint}>
                You earn {money(job.delivery_fee)} on this delivery.
                {job.cash_to_collect > 0 ? " Hand the cash back to the shop at the end of your shift." : ""}
              </Text>
            </View>

            {/* ── The one thing to do next ───────────────────────────── */}
            {stage === "offered" && (
              <>
                <AppButton title="Accept this delivery" onPress={onAccept} loading={accept.isPending} size="lg" />
                <Text style={styles.footHint}>
                  The full address and the customer's number appear once it is yours.
                </Text>
              </>
            )}

            {stage === "to_pickup" && (
              <>
                <AppButton title="I have collected it" onPress={onPickUp} loading={pickUp.isPending} size="lg" />
                <AppButton title="Hand it back" onPress={onDecline} variant="ghost" loading={decline.isPending} />
              </>
            )}

            {stage === "on_the_way" && (
              <View style={styles.otpCard}>
                <Text style={styles.otpTitle}>Ask for the 4-digit code</Text>
                <Text style={styles.otpBody}>
                  It is on the customer's order screen. It proves the order reached them.
                </Text>
                <AppTextInput
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 4))}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="0000"
                  style={styles.otpInput}
                />
                <AppButton
                  title="Delivered"
                  onPress={onDeliver}
                  loading={deliver.isPending}
                  disabled={code.trim().length !== 4}
                  size="lg"
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

function Leg({
  icon: Icon,
  caption,
  title,
  body,
  onCall,
  onNavigate,
  done,
}: {
  icon: typeof Store;
  caption: string;
  title: string;
  body: string;
  onCall?: () => void;
  onNavigate?: () => void;
  done?: boolean;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  return (
    <View style={[styles.card, done && styles.cardDone]}>
      <View style={styles.legTop}>
        <View style={[styles.legIcon, done && styles.legIconDone]}>
          {done ? (
            <CheckCircle2 size={17} color={c.success} strokeWidth={2.4} />
          ) : (
            <Icon size={17} color={c.primary} strokeWidth={2.2} />
          )}
        </View>
        <View style={styles.legCopy}>
          <Text style={styles.legCaption}>{caption}</Text>
          <Text style={styles.legTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.legBody}>{body}</Text>
        </View>
      </View>

      {(onCall || onNavigate) && (
        <View style={styles.legActions}>
          {onCall && (
            <Pressable style={styles.legBtn} accessibilityRole="button" accessibilityLabel="Call" onPress={onCall}>
              <Phone size={14} color={c.text} strokeWidth={2.2} />
              <Text style={styles.legBtnText}>Call</Text>
            </Pressable>
          )}
          {onNavigate && (
            <Pressable
              style={styles.legBtn}
              accessibilityRole="button"
              accessibilityLabel="Directions"
              onPress={onNavigate}
            >
              <Navigation size={14} color={c.text} strokeWidth={2.2} />
              <Text style={styles.legBtnText}>Directions</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },

    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: 8,
    },
    cardDone: { borderColor: c.success, backgroundColor: c.successBg },
    cashCard: { borderColor: c.warm, backgroundColor: c.warmSoft },
    cardTitle: { ...typography.label, color: c.text, fontSize: 13.5 },

    legTop: { flexDirection: "row", gap: spacing.sm },
    legIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    legIconDone: { backgroundColor: c.surface },
    legCopy: { flex: 1, gap: 2 },
    legCaption: {
      ...typography.tiny,
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      fontSize: 10,
      fontWeight: "700",
    },
    legTitle: { ...typography.label, color: c.text, fontSize: 15 },
    legBody: { ...typography.small, color: c.textSecondary, lineHeight: 18 },

    legActions: { flexDirection: "row", gap: spacing.xs },
    legBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      paddingVertical: 9,
    },
    legBtnText: { ...typography.small, color: c.text, fontWeight: "600" },

    item: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    itemQty: { ...typography.small, color: c.primary, fontWeight: "800", minWidth: 34 },
    itemName: { ...typography.small, color: c.text, flex: 1 },
    notes: { ...typography.small, color: c.textSecondary, fontStyle: "italic", marginTop: 2 },

    moneyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    moneyLabel: { ...typography.small, color: c.text, flex: 1, fontWeight: "600" },
    moneyValue: { ...typography.h3, color: c.text, fontSize: 17 },
    moneyHint: { ...typography.tiny, color: c.textSecondary, lineHeight: 16 },

    otpCard: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: c.primary,
      padding: spacing.md,
      gap: 8,
    },
    otpTitle: { ...typography.h3, color: c.text, fontSize: 16 },
    otpBody: { ...typography.small, color: c.textSecondary, lineHeight: 18 },
    otpInput: { textAlign: "center", fontSize: 26, letterSpacing: 12, fontWeight: "800" },

    footHint: { ...typography.tiny, color: c.textMuted, textAlign: "center" },

    gone: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: 8 },
    goneTitle: { ...typography.h3, color: c.text },
    goneBody: { ...typography.small, color: c.textMuted, textAlign: "center", lineHeight: 19 },
  });
