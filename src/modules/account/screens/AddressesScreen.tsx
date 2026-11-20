import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BuildingIcon, HomeIcon, MapPinIcon, PencilIcon, PlusIcon, TagIcon, TrashIcon } from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { EmptyState } from "../../../common/ui/EmptyState";
import { Touchable } from "../../../common/ui/Touchable";
import { AppButton } from "../../../common/ui/AppButton";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { confirm } from "../../../common/ui/confirm";
import { toast } from "../../../common/ui/toast";
import { apiDelete, apiGet, apiPut } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { labelKind, splitAddress } from "../addressForm";
import type { SavedAddress } from "./AddressPinScreen";

const KIND_ICON = { Home: HomeIcon, Work: BuildingIcon, Other: TagIcon } as const;

/**
 * MY ADDRESSES — foodpanda's list.
 *
 * One card per place: its name (Home / Work / your own) with a matching icon,
 * the house line and the street under it, "Default" on the one checkout
 * starts with. Tap a card to edit it on the map; the small buttons make it the
 * default or remove it (asked first). "Add new address" is always on screen.
 *
 * The old screen saved whatever GPS said at that moment under a typed line,
 * with no map — a person at work could not save "Home".
 */
export function AddressesScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["addresses"],
    queryFn: async () => (await apiGet<SavedAddress[]>("/customer/addresses")).data,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["addresses"] });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<null>(`/customer/addresses/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Address removed");
    },
    onError: () => toast.error("Couldn't remove it. Try again."),
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => apiPut<SavedAddress>(`/customer/addresses/${id}`, { is_default: true }),
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't change the default. Try again."),
  });

  const askRemove = async (a: SavedAddress) => {
    const yes = await confirm.ask({
      title: `Remove "${a.label}"?`,
      message: "You can add it again any time.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (yes) remove.mutate(a.id);
  };

  const add = () => navigation.navigate("AddressPin");

  return (
    <SafeScreen backgroundColor={c.bg}>
      <ScreenHeader title="My addresses" />

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
          contentContainerStyle={[styles.list, styles.grow]}
          ListEmptyComponent={
            <EmptyState
              icon={MapPinIcon}
              title="No saved addresses"
              message="Save Home, Work and the places you order to — checkout fills them in for you."
            />
          }
          renderItem={({ item }) => {
            const kind = labelKind(item.label);
            const KindIcon = KIND_ICON[kind];
            const { details, place } = splitAddress(item.address);
            return (
              <Touchable
                style={[styles.card, item.is_default && styles.cardDefault]}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.label}`}
                onPress={() => navigation.navigate("AddressPin", { address: item })}
              >
                <View style={styles.top}>
                  <View style={styles.kindIcon}>
                    <KindIcon size={18} color={c.primary} bold />
                  </View>
                  <View style={styles.info}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {item.is_default && <Text style={styles.defaultBadge}>Default</Text>}
                    </View>
                    {!!details && (
                      <Text style={styles.details} numberOfLines={1}>
                        {details}
                      </Text>
                    )}
                    <Text style={styles.place} numberOfLines={2}>
                      {place}
                    </Text>
                  </View>
                  <PencilIcon size={16} color={c.textMuted} />
                </View>

                <View style={styles.actions}>
                  {!item.is_default ? (
                    <Pressable
                      hitSlop={6}
                      onPress={() => makeDefault.mutate(item.id)}
                      disabled={makeDefault.isPending}
                      accessibilityRole="button"
                      accessibilityLabel={`Make ${item.label} the default`}
                    >
                      <Text style={styles.action}>Set as default</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.actionNote}>Checkout starts here</Text>
                  )}
                  <Pressable
                    hitSlop={8}
                    style={styles.remove}
                    onPress={() => askRemove(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.label}`}
                  >
                    <TrashIcon size={16} color={c.error} />
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              </Touchable>
            );
          }}
        />
      )}

      <View style={styles.footer}>
        <AppButton title="Add new address" icon={PlusIcon} onPress={add} size="lg" />
      </View>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    list: { padding: spacing.md, gap: spacing.ms },
    /** So `ListEmptyComponent` has a screen to centre in. */
    grow: { flexGrow: 1 },

    card: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.ms,
    },
    cardDefault: { borderColor: c.primary },
    top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.ms },
    kindIcon: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    info: { flex: 1, gap: 2 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    name: { ...typography.label, color: c.text, fontSize: 15, lineHeight: 20, flexShrink: 1 },
    defaultBadge: {
      ...typography.tiny,
      color: c.primary,
      backgroundColor: c.primarySoft,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 8,
      overflow: "hidden",
      fontWeight: "700",
    },
    details: { ...typography.small, color: c.text },
    place: { ...typography.small, color: c.textMuted },

    actions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    action: { ...typography.label, color: c.primary, fontSize: 13, lineHeight: 18 },
    actionNote: { ...typography.tiny, color: c.textMuted },
    remove: { flexDirection: "row", alignItems: "center", gap: 4 },
    removeText: { ...typography.label, color: c.error, fontSize: 13, lineHeight: 18 },

    footer: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      backgroundColor: c.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
  });
