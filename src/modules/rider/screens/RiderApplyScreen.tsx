import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { launchCamera, launchImageLibrary, type Asset } from "react-native-image-picker";
import {
  Bike,
  Car,
  Check,
  CircleAlert,
  Clock,
  IdCard,
  Truck,
  Upload,
  type LucideIcon,
} from "lucide-react-native";
import { BRAND } from "../../../common/brand";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { AppButton } from "../../../common/ui/AppButton";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { confirm } from "../../../common/ui/confirm";
import { toast } from "../../../common/ui/toast";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useRiderActions, useRiderProfile } from "../hooks/useRider";
import type { VehicleType } from "../services/riderService";

/**
 * Becoming a rider.
 *
 * ── One screen, five states ──────────────────────────────────────────
 *
 * Never applied · draft · under review · not approved · suspended. They are
 * genuinely the same screen — the same form, the same documents — differing
 * only in what can still be changed and what the banner at the top says. Five
 * screens would be five places to fix the CNIC field.
 *
 * ── Why the form comes before the photographs ────────────────────────
 *
 * The vehicle decides which documents are asked for: a cyclist has no licence
 * and no registration book, and asking anyway is a form nobody can finish. So
 * the vehicle is chosen, the application is created, and only then does the
 * server say what it wants.
 */

const VEHICLES: { value: VehicleType; label: string; icon: LucideIcon }[] = [
  { value: "bike", label: "Motorbike", icon: Bike },
  { value: "cycle", label: "Bicycle", icon: Bike },
  { value: "car", label: "Car", icon: Car },
  { value: "van", label: "Van", icon: Truck },
];

export function RiderApplyScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const rider = useRiderProfile();
  const { apply, uploadDocument, submit } = useRiderActions();

  const profile = rider.data ?? null;
  const [vehicle, setVehicle] = React.useState<VehicleType>("bike");
  const [cnic, setCnic] = React.useState("");
  const [reg, setReg] = React.useState("");
  const [platform, setPlatform] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);

  // Seed from the server ONCE it has answered — and only then. Writing these
  // on every render would fight the person typing.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || profile == null) return;
    seeded.current = true;
    setVehicle(profile.vehicle_type);
    setReg(profile.vehicle_registration ?? "");
    setPlatform(profile.is_platform);
  }, [profile]);

  const editable = profile == null || profile.status === "draft" || profile.status === "rejected";
  const locked = profile != null && !editable;

  const saveDetails = () => {
    apply
      .mutateAsync({
        vehicle_type: vehicle,
        vehicle_registration: reg.trim() || null,
        cnic: cnic.trim() || `${profile?.cnic_last4 ?? ""}`,
        is_platform: platform,
      })
      .then(() => toast.success("Details saved"))
      .catch(() => {});
  };

  /**
   * Take or choose one photograph.
   *
   * Both doors, because both fail for real people: a rider whose camera
   * permission was denied once has no way back to it inside this app, and a
   * rider who already photographed their CNIC last week should not have to do
   * it again.
   */
  const pickFor = async (type: string, label: string) => {
    const useCamera = await confirm.ask({
      title: label,
      message: "Take a photo now, or choose one you already have.",
      confirmLabel: "Take photo",
      cancelLabel: "Choose file",
    });

    const res = await (useCamera
      ? launchCamera({ mediaType: "photo", quality: 0.7, maxWidth: 1600, maxHeight: 1600 })
      : launchImageLibrary({ mediaType: "photo", quality: 0.7, maxWidth: 1600, maxHeight: 1600 }));

    if (res.didCancel) return;
    if (res.errorCode) {
      toast.error(
        res.errorCode === "permission"
          ? "Allow camera access in your phone settings to take a photo."
          : (res.errorMessage ?? "Could not open the camera."),
      );
      return;
    }

    const asset: Asset | undefined = res.assets?.[0];
    if (!asset?.uri) return;

    setBusy(type);
    uploadDocument
      .mutateAsync({
        type,
        file: {
          uri: asset.uri,
          name: asset.fileName ?? `${type}.jpg`,
          type: asset.type ?? "image/jpeg",
        },
      })
      .then(() => toast.success(`${label} uploaded`))
      .catch(() => {})
      .finally(() => setBusy(null));
  };

  const send = () => {
    submit
      .mutateAsync()
      .then(() => toast.success("Sent for review"))
      .catch(() => {});
  };

  if (rider.isError) {
    return (
      <SafeScreen edges={["top", "bottom"]}>
        <ScreenHeader title="Become a rider" />
        <LoadFailed what="your rider account" error={rider.error} onRetry={() => rider.refetch()} />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen edges={["top", "bottom"]}>
      <ScreenHeader
        title={profile == null ? "Become a rider" : "Rider application"}
        subtitle={profile?.rider_code ?? "Deliver orders and earn"}
      />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* ── Where this application stands ─────────────────────────── */}
        {profile != null && <StatusBanner profile={profile} />}

        {profile == null && (
          <View style={styles.pitch}>
            <Text style={styles.pitchTitle}>Ride with {BRAND.name}</Text>
            <Text style={styles.pitchBody}>
              Use the same account you shop with. Once you are approved a switch appears in the
              menu: go online, take deliveries near you, and see what you have earned.
            </Text>
          </View>
        )}

        {/* ── Your vehicle ──────────────────────────────────────────── */}
        <Text style={styles.caption}>Your vehicle</Text>
        <View style={styles.vehicles}>
          {VEHICLES.map((v) => {
            const on = vehicle === v.value;
            const Icon = v.icon;
            return (
              <Pressable
                key={v.value}
                style={[styles.vehicle, on && styles.vehicleOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={v.label}
                disabled={locked}
                onPress={() => setVehicle(v.value)}
              >
                <Icon size={20} color={on ? c.onPrimary : c.text} strokeWidth={2} />
                <Text style={[styles.vehicleText, on && styles.vehicleTextOn]}>{v.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.card}>
          <AppTextInput
            label="CNIC number"
            icon={IdCard}
            value={cnic}
            onChangeText={setCnic}
            editable={editable}
            keyboardType="number-pad"
            maxLength={15}
            placeholder={profile?.cnic_last4 ? `•••••-•••••••-${profile.cnic_last4.slice(-1)}` : "35202-1234567-1"}
          />
          {vehicle !== "cycle" && (
            <AppTextInput
              label="Number plate (optional)"
              value={reg}
              onChangeText={setReg}
              editable={editable}
              autoCapitalize="characters"
              placeholder="LEA-1234"
            />
          )}

          <Pressable
            style={styles.switchRow}
            accessibilityRole="switch"
            accessibilityState={{ checked: platform }}
            accessibilityLabel="Take deliveries from any shop"
            disabled={locked}
            onPress={() => setPlatform((p) => !p)}
          >
            <View style={styles.switchCopy}>
              <Text style={styles.switchLabel}>Take work from any shop</Text>
              <Text style={styles.switchHint}>
                Off means only shops that add you by your rider id can send you deliveries.
              </Text>
            </View>
            <View style={[styles.box, platform && styles.boxOn]}>
              {platform && <Check size={14} color={c.onPrimary} strokeWidth={3} />}
            </View>
          </Pressable>

          {editable && (
            <AppButton
              title={profile == null ? "Start application" : "Save details"}
              onPress={saveDetails}
              loading={apply.isPending}
              variant={profile == null ? "primary" : "outline"}
            />
          )}
        </View>

        {/* ── Documents ─────────────────────────────────────────────── */}
        {profile != null && (
          <>
            <Text style={styles.caption}>Documents</Text>
            <View style={styles.card}>
              {profile.required_documents.map((d) => {
                const have = profile.documents.find((x) => x.type === d.type);
                const rejected = have?.status === "rejected";
                return (
                  <Pressable
                    key={d.type}
                    style={styles.doc}
                    accessibilityRole="button"
                    accessibilityLabel={d.label}
                    disabled={!editable || busy !== null}
                    onPress={() => pickFor(d.type, d.label)}
                  >
                    <View
                      style={[
                        styles.docIcon,
                        have && !rejected && styles.docIconOk,
                        rejected && styles.docIconBad,
                      ]}
                    >
                      {busy === d.type ? (
                        <Clock size={17} color={c.textMuted} strokeWidth={2.2} />
                      ) : have && !rejected ? (
                        <Check size={17} color={c.success} strokeWidth={2.6} />
                      ) : rejected ? (
                        <CircleAlert size={17} color={c.error} strokeWidth={2.4} />
                      ) : (
                        <Upload size={17} color={c.textMuted} strokeWidth={2.2} />
                      )}
                    </View>
                    <View style={styles.docCopy}>
                      <Text style={styles.docLabel}>{d.label}</Text>
                      <Text
                        style={[styles.docHint, rejected && styles.docHintBad]}
                        numberOfLines={2}
                      >
                        {busy === d.type
                          ? "Uploading…"
                          : rejected
                            ? (have?.review_note ?? "Not accepted — take another photo")
                            : have
                              ? "Uploaded"
                              : "Tap to add a photo"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {editable && (
              <AppButton
                title="Send for review"
                onPress={send}
                loading={submit.isPending}
                disabled={!profile.can_submit}
                size="lg"
                style={styles.send}
              />
            )}
            {editable && !profile.can_submit && (
              <Text style={styles.sendHint}>
                Add every document above and we will check them within a day.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

/** Where the application stands, in one sentence the applicant can act on. */
function StatusBanner({ profile }: { profile: NonNullable<ReturnType<typeof useRiderProfile>["data"]> }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const tone =
    profile.status === "approved" ? "ok" : profile.status === "draft" ? "info" : profile.status === "pending" ? "wait" : "bad";

  const body =
    profile.review_note ??
    {
      draft: "Add your documents and send it in.",
      pending: "We are checking your documents. This usually takes a day.",
      approved: "You can go online from the menu and start taking deliveries.",
      rejected: "Fix what is noted below and send it again.",
      suspended: "Contact support to have this looked at.",
    }[profile.status];

  return (
    <View
      style={[
        styles.banner,
        tone === "ok" && styles.bannerOk,
        tone === "bad" && styles.bannerBad,
        tone === "wait" && styles.bannerWait,
      ]}
    >
      <Text style={styles.bannerTitle}>{profile.status_label}</Text>
      <Text style={styles.bannerBody}>{body}</Text>
      <Text style={styles.bannerCode}>Your rider id · {profile.rider_code}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.xs },

    pitch: { gap: 6, marginBottom: spacing.sm },
    pitchTitle: { ...typography.h3, color: c.text },
    pitchBody: { ...typography.small, color: c.textSecondary, lineHeight: 19 },

    banner: {
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: 3,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: spacing.sm,
    },
    bannerOk: { backgroundColor: c.successBg, borderColor: c.success },
    bannerBad: { backgroundColor: c.errorBg, borderColor: c.error },
    bannerWait: { backgroundColor: c.warningBg, borderColor: c.warning },
    bannerTitle: { ...typography.label, color: c.text, fontSize: 15 },
    bannerBody: { ...typography.small, color: c.textSecondary, lineHeight: 18 },
    bannerCode: { ...typography.tiny, color: c.textMuted, marginTop: 4, fontWeight: "700" },

    caption: {
      ...typography.tiny,
      color: c.textMuted,
      fontWeight: "700",
      marginTop: spacing.md,
      marginBottom: 6,
    },

    vehicles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    vehicle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    vehicleOn: { backgroundColor: c.primary, borderColor: c.primary },
    vehicleText: { ...typography.small, color: c.text, fontWeight: "600" },
    vehicleTextOn: { color: c.onPrimary },

    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.sm,
      marginTop: spacing.xs,
    },

    switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    switchCopy: { flex: 1, gap: 2 },
    switchLabel: { ...typography.body, color: c.text, fontSize: 14.5, fontWeight: "600" },
    switchHint: { ...typography.tiny, color: c.textMuted, lineHeight: 15 },
    box: {
      width: 24,
      height: 24,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    boxOn: { backgroundColor: c.primary, borderColor: c.primary },

    doc: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
    docIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    docIconOk: { backgroundColor: c.successBg },
    docIconBad: { backgroundColor: c.errorBg },
    docCopy: { flex: 1, gap: 1 },
    docLabel: { ...typography.body, color: c.text, fontSize: 14.5, fontWeight: "500" },
    docHint: { ...typography.tiny, color: c.textMuted },
    docHintBad: { color: c.error },

    send: { marginTop: spacing.md },
    sendHint: {
      ...typography.tiny,
      color: c.textMuted,
      textAlign: "center",
      marginTop: 6,
    },
  });
