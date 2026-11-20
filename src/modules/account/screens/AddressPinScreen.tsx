import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import MapView, { PROVIDER_GOOGLE, type Region } from "react-native-maps";
import {
  BuildingIcon,
  CrosshairIcon,
  HomeIcon,
  MapPinIcon,
  SearchIcon,
  TagIcon,
  XIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { AppButton } from "../../../common/ui/AppButton";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { KEYBOARD_BEHAVIOR } from "../../../common/ui/KeyboardScreen";
import { toast } from "../../../common/ui/toast";
import { apiPost, apiPut } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useLocationStore } from "../../../stores/locationStore";
import { askForLocation, currentPosition } from "../../../services/position";
import { reverseGeocode, searchAddress, type AddressSuggestion } from "../../../services/geo";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import {
  canSave,
  composeAddress,
  customName,
  finalLabel,
  LABEL_KINDS,
  LABEL_MAX,
  labelKind,
  type LabelKind,
  needsLookup,
  pinKey,
  splitAddress,
} from "../addressForm";

export interface SavedAddress {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
}

/**
 * Where the map opens when there is no pin anywhere yet — a city centre, only
 * until "where you are" answers (asked at once on a new address).
 */
const FALLBACK = { lat: 31.5204, lng: 74.3587 };
/** About two streets across: close enough to see the door, wide enough to see the road. */
const ZOOM = { latitudeDelta: 0.004, longitudeDelta: 0.004 };

/** Streets already looked up this session, by an ~11 m key — the map is panned back and forth a lot. */
const streets = new Map<string, string | null>();

const KIND_ICON: Record<LabelKind, typeof HomeIcon> = { Home: HomeIcon, Work: BuildingIcon, Other: TagIcon };

/**
 * ADD OR EDIT AN ADDRESS ON A MAP — foodpanda's way.
 *
 * "address screen py ja k current location b select kr sky, jb kry uska name
 * add kry, or search main map sy search krk mazeed address b add kr sky."
 *
 * The pin stays in the middle and the MAP moves under it; when it stops, the
 * street under the pin is looked up (once per ~15 m, remembered). Search moves
 * the map to a place; the round button moves it to where the phone is. Then
 * the house / flat / floor, a name — Home, Work, or your own — and Save.
 *
 * Params: `id` + the saved row to edit one; `deliverHere` to also make the
 * new address the delivery pin (when opened from "Deliver to").
 */
export function AddressPinScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const editing: SavedAddress | undefined = route.params?.address;
  const deliverHere: boolean = !!route.params?.deliverHere;
  const qc = useQueryClient();
  const store = useLocationStore();

  const start = React.useMemo(() => {
    if (editing?.latitude != null && editing?.longitude != null)
      return { lat: editing.latitude, lng: editing.longitude };
    if (store.lat != null && store.lng != null) return { lat: store.lat, lng: store.lng };
    return FALLBACK;
    // The map's FIRST view only; later pin changes move it through animateToRegion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const first = splitAddress(editing?.address);
  const map = useRef<MapView>(null);
  const [center, setCenter] = useState(start);
  const [place, setPlace] = useState<string | null>(editing ? first.place : null);
  const [finding, setFinding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [details, setDetails] = useState(first.details);
  const [kind, setKind] = useState<LabelKind>(editing ? labelKind(editing.label) : "Home");
  const [custom, setCustom] = useState(editing ? customName(editing.label) : "");

  // Search
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query, 350);
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  /** The last point a street was asked for; an edited row already has its street. */
  const asked = useRef<{ lat: number; lng: number } | null>(editing ? start : null);
  const ticket = useRef(0);

  const lookUp = React.useCallback(async (lat: number, lng: number) => {
    if (!needsLookup(asked.current, { lat, lng })) return;
    asked.current = { lat, lng };
    const key = pinKey(lat, lng);
    if (streets.has(key)) {
      setPlace(streets.get(key) ?? null);
      return;
    }
    const mine = ++ticket.current;
    setFinding(true);
    const line = await reverseGeocode(lat, lng);
    streets.set(key, line);
    // A newer move answered first — this one is stale.
    if (mine !== ticket.current) return;
    setPlace(line);
    setFinding(false);
  }, []);

  const moveTo = (lat: number, lng: number) => {
    map.current?.animateToRegion({ latitude: lat, longitude: lng, ...ZOOM }, 450);
  };

  const goToMe = React.useCallback(async () => {
    setLocating(true);
    const allowed = await askForLocation("uses your location to put the pin on your door.");
    if (!allowed) {
      setLocating(false);
      toast.info("Location is off — search for your area or move the map.");
      return;
    }
    const { fix } = await currentPosition({ highAccuracy: true });
    setLocating(false);
    if (!fix) {
      toast.info("Couldn't find you — search for your area or move the map.");
      return;
    }
    moveTo(fix.latitude, fix.longitude);
  }, []);

  // A NEW address with no pin anywhere starts where the phone is, as foodpanda does.
  useEffect(() => {
    if (!editing && store.lat == null) goToMe();
    else if (!editing) lookUp(start.lat, start.lng);
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    const text = q.trim();
    if (text.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchAddress(text, center).then((r) => {
      if (!alive) return;
      setResults(r ?? []);
      setSearching(false);
    });
    return () => {
      alive = false;
    };
    // The bias is where the map is when the words change, not every pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const onMoved = (r: Region) => {
    const next = { lat: r.latitude, lng: r.longitude };
    setCenter(next);
    lookUp(next.lat, next.lng);
  };

  const pickResult = (s: AddressSuggestion) => {
    Keyboard.dismiss();
    setQuery("");
    setResults([]);
    // The search already named this place: no second lookup for the same point.
    const named = s.detail ? `${s.label}, ${s.detail}` : s.label;
    asked.current = { lat: s.lat, lng: s.lng };
    streets.set(pinKey(s.lat, s.lng), named);
    ticket.current++;
    setFinding(false);
    setPlace(named);
    moveTo(s.lat, s.lng);
  };

  const label = finalLabel(kind, custom);
  const line = composeAddress(details, place);
  const ready = canSave({ lat: center.lat, lng: center.lng, place, details });

  const save = useMutation({
    mutationFn: async () => {
      const body = { label, address: line, latitude: center.lat, longitude: center.lng };
      return editing
        ? (await apiPut<SavedAddress>(`/customer/addresses/${editing.id}`, body)).data
        : (await apiPost<SavedAddress>("/customer/addresses", body)).data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["addresses"] });
      toast.success(editing ? "Address updated" : "Address saved");
      if (deliverHere) {
        await store.setPin(center.lat, center.lng, `${label} · ${place ?? line}`);
        navigation.pop(2);
        return;
      }
      navigation.goBack();
    },
    onError: () => toast.error("Couldn't save the address. Check your connection and try again."),
  });

  return (
    <SafeScreen backgroundColor={c.bg}>
      <ScreenHeader title={editing ? "Edit address" : "Add an address"} />

      {/* The keyboard pushes the sheet up and the map gets shorter, never the other way round. */}
      <KeyboardAvoidingView style={styles.flex} behavior={KEYBOARD_BEHAVIOR}>
        <View style={styles.mapWrap}>
          <MapView
            ref={map}
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={{ latitude: start.lat, longitude: start.lng, ...ZOOM }}
            onRegionChangeComplete={onMoved}
            showsUserLocation
            showsMyLocationButton={false}
            toolbarEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            // The sheet overlaps the map's bottom edge; Google's mark must stay visible above it.
            mapPadding={{ top: 0, right: 0, left: 0, bottom: radius.lg }}
          />

          {/* The pin is the middle of the map; the map moves under it. */}
          <View style={styles.pinWrap} pointerEvents="none">
            <View style={[styles.pinHead, { backgroundColor: c.primary }]}>
              <MapPinIcon size={20} color={c.onPrimary} bold />
            </View>
            <View style={[styles.pinStem, { backgroundColor: c.primary }]} />
            <View style={styles.pinShadow} />
          </View>

          <View style={styles.searchWrap}>
            <AppTextInput
              icon={SearchIcon}
              placeholder="Search for your area or street"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              returnKeyType="search"
              style={styles.searchInput}
              trailing={
                query ? (
                  <Pressable hitSlop={8} onPress={() => setQuery("")} accessibilityLabel="Clear search">
                    <XIcon size={16} color={c.textMuted} />
                  </Pressable>
                ) : null
              }
            />
            {(results.length > 0 || (searching && q.trim().length >= 3)) && (
              <View style={styles.results}>
                {searching && results.length === 0 ? (
                  <ActivityIndicator style={styles.resultsBusy} color={c.primary} />
                ) : (
                  <FlatList
                    data={results}
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={(s, i) => `${s.lat}-${s.lng}-${i}`}
                    renderItem={({ item }) => (
                      <Pressable
                        style={({ pressed }) => [styles.result, pressed && styles.resultPressed]}
                        onPress={() => pickResult(item)}
                      >
                        <MapPinIcon size={16} color={c.textMuted} />
                        <View style={styles.flex}>
                          <Text style={styles.resultTitle} numberOfLines={1}>
                            {item.label}
                          </Text>
                          {!!item.detail && (
                            <Text style={styles.resultMeta} numberOfLines={1}>
                              {item.detail}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    )}
                  />
                )}
              </View>
            )}
          </View>

          <Pressable
            style={styles.locate}
            onPress={goToMe}
            accessibilityRole="button"
            accessibilityLabel="Use my current location"
          >
            {locating ? <ActivityIndicator color={c.primary} /> : <CrosshairIcon size={20} color={c.primary} />}
            <Text style={styles.locateText}>Current location</Text>
          </Pressable>
        </View>

        <View style={styles.sheet}>
          <View style={styles.placeRow}>
            <View style={styles.placeIcon}>
              <MapPinIcon size={18} color={c.primary} bold />
            </View>
            <View style={styles.flex}>
              <Text style={styles.placeHint}>{finding ? "Finding the street…" : "Delivering to"}</Text>
              <Text style={styles.placeLine} numberOfLines={2}>
                {place || "Move the map so the pin is on your door"}
              </Text>
            </View>
          </View>

          <AppTextInput
            placeholder="House / flat no., floor, street"
            value={details}
            onChangeText={setDetails}
            maxLength={160}
            style={styles.detailsInput}
          />

          <Text style={styles.saveAs}>Save as</Text>
          <View style={styles.kinds}>
            {LABEL_KINDS.map((k) => {
              const on = k === kind;
              const KindIcon = KIND_ICON[k];
              return (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.kind, on ? styles.kindOn : styles.kindOff]}
                >
                  <KindIcon size={16} color={on ? c.primary : c.textSecondary} bold={on} />
                  <Text style={[styles.kindText, on && styles.kindTextOn]}>{k}</Text>
                </Pressable>
              );
            })}
          </View>
          {kind === "Other" && (
            <AppTextInput
              placeholder="Name it — e.g. Ammi's house, Gym"
              value={custom}
              onChangeText={setCustom}
              maxLength={LABEL_MAX}
              style={styles.detailsInput}
            />
          )}

          <AppButton
            title={editing ? "Save changes" : "Save address"}
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={!ready || save.isPending}
            size="lg"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    mapWrap: { flex: 1, overflow: "hidden" },
    map: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },

    // The tip of the stem is the map's centre: the head sits above it.
    pinWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      // 54 lifts the stem tip to the centre; + the map padding the sheet takes.
      paddingBottom: 54 + radius.lg,
    },
    pinHead: {
      width: 40,
      height: 40,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 3,
      borderColor: c.surface,
    },
    pinStem: { width: 3, height: 14, borderRadius: 1 },
    pinShadow: { width: 10, height: 4, borderRadius: 1.5, backgroundColor: "rgba(0,0,0,0.25)" },

    searchWrap: { position: "absolute", top: spacing.sm, left: spacing.md, right: spacing.md },
    searchInput: { marginBottom: 0 },
    results: {
      marginTop: -spacing.sm,
      maxHeight: 260,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
    },
    resultsBusy: { paddingVertical: spacing.md },
    result: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.ms,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    resultPressed: { backgroundColor: c.surfaceAlt },
    resultTitle: { ...typography.label, color: c.text, fontSize: 14, lineHeight: 19 },
    resultMeta: { ...typography.tiny, color: c.textMuted },

    locate: {
      position: "absolute",
      right: spacing.md,
      bottom: spacing.md + radius.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 40,
      paddingHorizontal: spacing.ms,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    locateText: { ...typography.label, color: c.primary, fontSize: 13, lineHeight: 18 },

    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      marginTop: -radius.lg,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    placeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.ms },
    placeIcon: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    placeHint: { ...typography.tiny, color: c.textMuted },
    placeLine: { ...typography.label, color: c.text, fontSize: 15, lineHeight: 20 },
    detailsInput: { marginBottom: spacing.ms },
    saveAs: { ...typography.label, color: c.text, marginBottom: spacing.xs },
    kinds: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.ms },
    kind: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 40,
      paddingHorizontal: spacing.md,
      borderRadius: 14,
      borderWidth: 1.5,
    },
    kindOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
    kindOff: { borderColor: c.border, backgroundColor: c.surface },
    kindText: { ...typography.label, color: c.textSecondary, fontSize: 14, lineHeight: 18 },
    kindTextOn: { color: c.primary },
  });
