import React, { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, Crosshair, MapPin, Search } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { apiGet } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import { useLocationStore } from "../../../stores/locationStore";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { searchAddress, type AddressSuggestion } from "../../../services/geo";
import { useCities } from "../hooks/useMarketplace";

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
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const authed = useAuthStore((s) => s.status === "authenticated");
  const { lat, lng, label, status, detect, setPin } = useLocationStore();

  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  // `null` from searchAddress means the search could not be MADE — no provider
  // key — which is a different sentence from "nothing matched".
  const [canSearch, setCanSearch] = useState(true);

  useEffect(() => {
    let alive = true;
    if (debounced.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    searchAddress(debounced, lat != null && lng != null ? { lat, lng } : undefined)
      .then((r) => {
        if (!alive) return;
        setCanSearch(r !== null);
        setSuggestions(r ?? []);
      })
      .finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; };
  }, [debounced, lat, lng]);

  /**
   * Cities, from our own rows.
   *
   * Street search needs a geocoding key and there is not one configured, so
   * without this the only control on the screen returned nothing and a person
   * whose GPS guessed wrong had no way to correct it. A city is also the half
   * that MATTERS here — the marketplace lists by city, and a pin four streets
   * over changes nothing about which shops appear.
   */
  const cities = useCities(debounced);
  const cityRows = cities.data ?? [];

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
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={c.text} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Delivery location</Text>
        {/*
          A SPACER, so the title sits centred between two equal margins — and
          it must NOT reuse `styles.back`, which carries a surface fill and a
          border. Reused, the balancing gap renders as an empty white circle
          floating in the top right. Same bug, third screen.
        */}
        <View style={styles.headSpacer} />
      </View>

      <View style={styles.searchWrap}>
        <AppTextInput
          icon={Search}
          placeholder="Search a city, area or landmark…"
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
        ListEmptyComponent={
          // Three different silences, and the screen used to show the same
          // blank space for all of them.
          !debounced.trim() || debounced.trim().length < 3 ? null : searching ? null : !canSearch ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>Street search isn&rsquo;t set up yet</Text>
              <Text style={styles.emptyText}>
                Pick a city above, or use “Use my current location” — both work
                without it.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyText}>
                Try a landmark or a wider area, or drop a pin with “Use my
                current location”.
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <>
            {/* Use current location */}
            <Pressable style={styles.currentRow} onPress={() => { detect(); navigation.goBack(); }}>
              <View style={styles.currentIcon}>
                <Crosshair size={18} color={c.brand[600]} strokeWidth={2.2} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.currentText}>Use my current location</Text>
                {label && <Text style={styles.rowMeta} numberOfLines={1}>Now: {label}</Text>}
              </View>
            </Pressable>
            {status === "denied" && (
              <Text style={styles.deniedHint}>Location permission is off — search your address instead.</Text>
            )}

            {cityRows.length > 0 && (
              <View style={styles.cityBlock}>
                <Text style={styles.blockTitle}>
                  {debounced.trim().length >= 2 ? "Cities" : "We deliver in"}
                </Text>
                {cityRows.map((city) => (
                  <Pressable
                    key={city.id}
                    style={styles.row}
                    accessibilityRole="button"
                    accessibilityLabel={`Deliver to ${city.name}`}
                    onPress={() =>
                      city.latitude != null && city.longitude != null
                        ? pick(city.latitude, city.longitude, city.name)
                        : undefined
                    }
                  >
                    <View style={styles.cityIcon}>
                      <Building2 size={16} color={c.primary} strokeWidth={2.2} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle}>{city.name}</Text>
                      <Text style={styles.rowMeta}>
                        {city.shops_count} {city.shops_count === 1 ? "shop" : "shops"}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {searching && <Text style={styles.searchingHint}>Searching…</Text>}
          </>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => pick(item.lat, item.lng, item.label)}>
            <MapPin size={17} color={c.gray[400]} strokeWidth={2} />
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
                  <MapPin size={17} color={c.brand[600]} strokeWidth={2} />
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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headSpacer: { width: 40 },
  cityBlock: { marginTop: spacing.sm },
  blockTitle: {
    ...typography.tiny,
    color: c.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  cityIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: c.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.h3, color: c.text },
  searchWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  emptyWrap: { alignItems: "center", paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  emptyTitle: { ...typography.label, color: c.text, textAlign: "center" },
  emptyText: {
    ...typography.small,
    color: c.textSecondary,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },

  currentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.brand[50],
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  currentIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  currentText: { ...typography.label, color: c.brand[700], fontSize: 15 },
  deniedHint: { ...typography.tiny, color: c.warning, marginBottom: spacing.sm },
  searchingHint: { ...typography.tiny, color: c.gray[400], paddingVertical: spacing.xs },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  rowInfo: { flex: 1, gap: 1 },
  rowTitle: { ...typography.label, color: c.text, fontSize: 14 },
  rowMeta: { ...typography.tiny, color: c.gray[500] },
  defaultTag: { ...typography.tiny, color: c.brand[600] },

  savedBlock: { marginTop: spacing.md },
  savedTitle: { ...typography.h3, color: c.text, fontSize: 15, marginBottom: spacing.xs },
});
