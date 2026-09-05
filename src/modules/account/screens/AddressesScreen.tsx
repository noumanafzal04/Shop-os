import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Plus, Trash2 } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useLocationStore } from "../../../stores/locationStore";

interface CustomerAddress {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
}

/**
 * Saved delivery locations. "Use my current location" attaches the live GPS
 * pin — a full map picker replaces this later without API changes.
 */
export function AddressesScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const qc = useQueryClient();
  const { lat, lng, label: cityLabel } = useLocationStore();

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("Home");
  const [address, setAddress] = useState("");

  const list = useQuery({
    queryKey: ["addresses"],
    queryFn: async () => (await apiGet<CustomerAddress[]>("/customer/addresses")).data,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["addresses"] });

  const add = useMutation({
    mutationFn: () =>
      apiPost<CustomerAddress>("/customer/addresses", {
        label: label.trim() || "Home",
        address: address.trim(),
        latitude: lat,
        longitude: lng,
      }),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setAddress("");
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<null>(`/customer/addresses/${id}`),
    onSuccess: invalidate,
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => apiPut<CustomerAddress>(`/customer/addresses/${id}`, { is_default: true }),
    onSuccess: invalidate,
  });

  return (
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={c.text} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>My addresses</Text>
        <Pressable style={styles.back} onPress={() => setAdding((v) => !v)} hitSlop={8}>
          <Plus size={20} color={c.brand[600]} strokeWidth={2.2} />
        </Pressable>
      </View>

      {adding && (
        <View style={styles.form}>
          <AppTextInput placeholder="Label (Home / Work)" value={label} onChangeText={setLabel} />
          <AppTextInput placeholder="House, street, area…" value={address} onChangeText={setAddress} />
          <Text style={styles.pinNote}>
            📍 Pin: {lat != null ? `current location${cityLabel ? ` (${cityLabel})` : ""}` : "no GPS — address only"}
          </Text>
          <AppButton
            title={add.isPending ? "Saving…" : "Save address"}
            onPress={() => address.trim() && add.mutate()}
            disabled={add.isPending || !address.trim()}
          />
        </View>
      )}

      {list.isLoading ? (
        <View style={styles.list}>
          {[0, 1].map((i) => (
            <SkeletonListRow key={i} />
          ))}
        </View>
      ) : list.isError ? (
        <LoadFailed
          what="your saved addresses"
          error={list.error}
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <FlatList
          data={list.data ?? []}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !adding ? (
              <View style={styles.emptyWrap}>
                <MapPin size={32} color={c.gray[300]} strokeWidth={1.6} />
                <Text style={styles.empty}>No saved addresses — add one with +</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, item.is_default && styles.rowDefault]}
              onPress={() => !item.is_default && makeDefault.mutate(item.id)}
            >
              <View style={styles.rowIcon}>
                <MapPin size={18} color={c.brand[600]} strokeWidth={2} />
              </View>
              <View style={styles.rowInfo}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  {item.is_default && <Text style={styles.defaultBadge}>Default</Text>}
                </View>
                <Text style={styles.rowAddress} numberOfLines={2}>{item.address}</Text>
              </View>
              <Pressable hitSlop={8} onPress={() => remove.mutate(item.id)}>
                <Trash2 size={17} color={c.gray[300]} strokeWidth={2} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
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

  form: {
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  pinNote: { ...typography.tiny, color: c.gray[500] },

  list: { padding: spacing.md, gap: spacing.xs },
  emptyWrap: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.xxl },
  empty: { ...typography.small, color: c.gray[400] },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  rowDefault: { borderColor: c.brand[400] },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: c.brand[50],
    alignItems: "center",
    justifyContent: "center",
  },
  rowInfo: { flex: 1, gap: 2 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowLabel: { ...typography.label, color: c.text },
  defaultBadge: {
    ...typography.tiny,
    color: c.brand[700],
    backgroundColor: c.brand[50],
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    overflow: "hidden",
    fontWeight: "700",
  },
  rowAddress: { ...typography.small, color: c.gray[500] },
});
