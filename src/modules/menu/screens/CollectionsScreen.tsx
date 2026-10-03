import React, { useState } from "react";
import { Alert, FlatList, StyleSheet, Switch, Text, View } from "react-native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { AppButton } from "@cartze/core/ui/AppButton";
import { EmptyState } from "@cartze/core/ui/EmptyState";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { toast } from "@cartze/core/ui/toast";
import { ApiError } from "@cartze/core/types/api";
import { PencilIcon, SparkleIcon, TrashIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useCollectionEdits, useCollections } from "../hooks/useCatalog";

/**
 * SHELVES THE SHOP ARRANGES FOR ITSELF — "Ramzan deals", "New in".
 *
 * Separate from categories, and deliberately so. A category is what a thing IS
 * and every item has exactly one; a collection is a grouping the shop invents,
 * and an item may sit on several shelves or none. Offering them as one screen
 * with a toggle would make two different ideas look like one setting.
 *
 * ── Which products are on a shelf is not edited here ─────────────────
 *
 * The server takes `item_ids` on create and update, and picking them is a
 * scroll through the whole catalogue with checkboxes — a desk job. What this
 * screen does is the part that belongs on a phone: make a shelf, name it, show
 * or hide it, remove it. The count is drawn so a shelf is never a mystery.
 */
export function CollectionsScreen() {
  const c = useColors();
  const s = styles(c);
  const { data, isLoading } = useCollections();
  const edits = useCollectionEdits();

  const [adding, setAdding] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const say = (e: unknown, fallback: string) =>
    toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : fallback);

  async function add() {
    const name = adding.trim();
    if (!name || edits.add.isPending) return;
    try {
      await edits.add.mutateAsync(name);
      setAdding("");
      toast.success(`${name} added`);
    } catch (e) {
      say(e, "Could not add that collection");
    }
  }

  async function saveRename(id: string) {
    const name = editingName.trim();
    if (!name) return;
    try {
      await edits.rename.mutateAsync({ id, name });
      setEditingId(null);
      toast.success("Renamed");
    } catch (e) {
      say(e, "Could not rename that collection");
    }
  }

  function confirmRemove(id: string, name: string, count: number) {
    /**
     * The count is NAMED in the question.
     *
     * "Remove Ramzan deals?" and "Remove Ramzan deals — 24 products come off
     * this shelf?" are different questions. The products themselves are not
     * deleted and the message says so, because a shopkeeper who thinks they
     * might be will not press it.
     */
    Alert.alert(
      `Remove ${name}?`,
      count > 0
        ? `${count} ${count === 1 ? "product comes" : "products come"} off this shelf. They stay in your menu.`
        : "This shelf is empty.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            edits.remove
              .mutateAsync(id)
              .then(() => toast.success(`${name} removed`))
              .catch((e: unknown) => say(e, "Could not remove that collection"));
          },
        },
      ],
    );
  }

  return (
    <SafeScreen>
      <View style={s.adder}>
        <View style={s.adderField}>
          <AppTextInput
            placeholder="New collection — Ramzan deals"
            value={adding}
            onChangeText={setAdding}
            returnKeyType="done"
            onSubmitEditing={add}
            editable={!edits.add.isPending}
          />
        </View>
        <AppButton
          title="Add"
          onPress={add}
          loading={edits.add.isPending}
          disabled={adding.trim().length === 0}
        />
      </View>

      {isLoading ? (
        <View style={s.list}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={84} borderRadius={14} />
          ))}
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(row) => row.id}
          contentContainerStyle={[s.list, (data ?? []).length === 0 ? s.listEmpty : null]}
          ListEmptyComponent={
            <EmptyState
              icon={SparkleIcon}
              tone="muted"
              title="No collections yet"
              message="A collection is a shelf you arrange yourself — a Ramzan offer, this week's new items."
            />
          }
          renderItem={({ item }) => {
            const editing = editingId === item.id;
            const count = item.items_count ?? 0;

            return (
              <View style={s.card}>
                <View style={s.row}>
                  {editing ? (
                    <>
                      <View style={s.rowField}>
                        <AppTextInput
                          value={editingName}
                          onChangeText={setEditingName}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={() => saveRename(item.id)}
                        />
                      </View>
                      <AppButton title="Save" onPress={() => saveRename(item.id)} />
                    </>
                  ) : (
                    <>
                      <View style={s.rowText}>
                        <Text style={s.name} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={s.count}>
                          {count} {count === 1 ? "product" : "products"}
                        </Text>
                      </View>
                      <Touchable
                        onPress={() => {
                          setEditingId(item.id);
                          setEditingName(item.name);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Rename ${item.name}`}
                        hitSlop={8}
                        style={s.iconButton}
                      >
                        <PencilIcon size={18} color={c.textSecondary} />
                      </Touchable>
                      <Touchable
                        onPress={() => confirmRemove(item.id, item.name, count)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name}`}
                        hitSlop={8}
                        style={s.iconButton}
                      >
                        <TrashIcon size={18} color={c.error} />
                      </Touchable>
                    </>
                  )}
                </View>

                {!editing ? (
                  <View style={s.visRow}>
                    <Text style={s.visLabel}>Show on the shop page</Text>
                    <Switch
                      value={item.visible_in_marketplace}
                      onValueChange={(visible) => {
                        edits.setVisible
                          .mutateAsync({ id: item.id, visible })
                          .catch((e: unknown) => say(e, "Could not change that"));
                      }}
                      trackColor={{ true: c.primary, false: c.border }}
                      thumbColor={c.white}
                    />
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </SafeScreen>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    adder: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      padding: spacing.md,
      paddingBottom: 0,
    },
    adderField: { flex: 1 },
    list: { padding: spacing.md, gap: spacing.sm },
    listEmpty: { flexGrow: 1, justifyContent: "center" },
    card: {
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      gap: spacing.sm,
    },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
    rowField: { flex: 1 },
    rowText: { flex: 1 },
    name: { ...typography.body, fontSize: 16, color: c.text },
    count: { ...typography.small, color: c.textMuted, marginTop: 1 },
    iconButton: { padding: 6 },
    visRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: spacing.sm,
    },
    visLabel: { ...typography.small, color: c.textSecondary },
  });
