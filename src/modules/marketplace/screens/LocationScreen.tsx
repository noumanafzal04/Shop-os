import React, { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Crosshair, MapPin, Search } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { apiGet } from "../../../common/api/client";
import { colors, radius, spacing, typography } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import { useLocationStore } from "../../../stores/locationStore";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { searchAddress, type AddressSuggestion } from "../../../services/geo";

interface SavedAddress {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
}

/**
 * "Deliver to" picker (opened from the home header): use current GPS,
 * search any address (Geoapify autocomplete), or pick a saved address.
 * A full map-pin picker slots in here later (Google Maps phase).
 */
export function LocationScreen() {
  const navigation = useNavigation<any>();
  const authed = useAuthStore((s) => s.status === "authenticated");
  const { lat, lng, label, status, detect, setPin } = useLocationStore();

  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let alive = true;
    if (debounced.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    searchAddress(debounced, lat != null && lng != null ? { lat, lng } : undefined)
      .then((r) => { if (alive) setSuggestions(r); })
      .finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; };
  }, [debounced, lat, lng]);

  const saved = useQuery({
    queryKey: ["addresses"],
    queryFn: async () => (await apiGet<SavedAddress[]>("/customer/addresses")).data,
    enabled: authed,
  });

  const pick = async (plat: number, plng: number, plabel?: string) => {
    await setPin(plat, plng, plabel);
    navigation.goBack();
  };

  return (
    <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={colors.black} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Delivery location</Text>
        <View style={styles.back} />
      </View>

      <View style={styles.searchWrap}>
        <AppTextInput
          icon={Search}
          placeholder="Search street, area, landmark…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
      </View>

      <FlatList
        data={suggestions}
        keyExtractor={(s, i) => `${s.lat}-${s.lng}-${i}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {/* Use current location */}
            <Pressable style={styles.currentRow} onPress={() => { detect(); navigation.goBack(); }}>
              <View style={styles.currentIcon}>
                <Crosshair size={18} color={colors.brand[600]} strokeWidth={2.2} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.currentText}>Use my current location</Text>
                {label && <Text style={styles.rowMeta} numberOfLines={1}>Now: {label}</Text>}
              </View>
            </Pressable>
            {status === "denied" && (
              <Text style={styles.deniedHint}>Location permission is off — search your address instead.</Text>
            )}

            {searching && <Text style={styles.searchingHint}>Searching…</Text>}
          </>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => pick(item.lat, item.lng, item.label)}>
            <MapPin size={17} color={colors.gray[400]} strokeWidth={2} />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.label}</Text>
              {!!item.detail && <Text style={styles.rowMeta} numberOfLines={1}>{item.detail}</Text>}
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          authed && (saved.data?.length ?? 0) > 0 && query.trim().length < 3 ? (
            <View style={styles.savedBlock}>
              <Text style={styles.savedTitle}>Saved addresses</Text>
              {saved.data!.map((a) => (
                <Pressable
                  key={a.id}
                  style={styles.row}
                  onPress={() =>
                    a.latitude != null && a.longitude != null
                      ? pick(a.latitude, a.longitude, `${a.label} · ${a.address}`)
                      : undefined
                  }
                >
                  <MapPin size={17} color={colors.brand[600]} strokeWidth={2} />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle}>
                      {a.label} {a.is_default && <Text style={styles.defaultTag}>· default</Text>}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>{a.address}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null
        }
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.h3, color: colors.black },
  searchWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },

  currentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand[50],
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  currentIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  currentText: { ...typography.label, color: colors.brand[700], fontSize: 15 },
  deniedHint: { ...typography.tiny, color: colors.warning, marginBottom: spacing.sm },
  searchingHint: { ...typography.tiny, color: colors.gray[400], paddingVertical: spacing.xs },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  rowInfo: { flex: 1, gap: 1 },
  rowTitle: { ...typography.label, color: colors.black, fontSize: 14 },
  rowMeta: { ...typography.tiny, color: colors.gray[500] },
  defaultTag: { ...typography.tiny, color: colors.brand[600] },

  savedBlock: { marginTop: spacing.md },
  savedTitle: { ...typography.h3, color: colors.black, fontSize: 15, marginBottom: spacing.xs },
});
