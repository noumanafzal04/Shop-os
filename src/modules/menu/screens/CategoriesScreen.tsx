import React, { useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { AppButton } from "@cartze/core/ui/AppButton";
import { EmptyState } from "@cartze/core/ui/EmptyState";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { toast } from "@cartze/core/ui/toast";
import { ApiError } from "@cartze/core/types/api";
import { PencilIcon, TagIcon, TrashIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useCategories, useCategoryEdits } from "../hooks/useCatalog";

/**
 * WHAT A THING IS — Starters, Main Course, Beverages.
 *
 * A category is the kind of thing an item is, and it is what the shop page and
 * this app's own filter bar are grouped by. A collection is different and
 * lives on its own screen: a shelf the shop arranges for itself.
 *
 * ── Deleting is the server's decision, not this screen's ─────────────
 *
 * The server refuses to remove a category that still has products, and that
 * refusal names the reason. This screen does NOT pre-empt it with a count it
 * would have to keep in step — a stale count either blocks a delete that would
 * work or offers one that will not.
 */
export function CategoriesScreen() {
  const c = useColors();
  const s = styles(c);
  const { data, isLoading } = useCategories();
  const edits = useCategoryEdits();

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
      say(e, "Could not add that category");
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
      say(e, "Could not rename that category");
    }
  }

  function confirmRemove(id: string, name: string) {
    /**
     * ASKED, because it is not undoable from this app.
     *
     * The server soft-deletes, so nothing is truly lost — but there is no
     * restore on this screen, and a row that vanishes on a mis-tap during
     * service is a row the shopkeeper cannot bring back without the panel.
     */
    Alert.alert(`Remove ${name}?`, "Products in it will have no category.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          edits.remove
            .mutateAsync(id)
            .then(() => toast.success(`${name} removed`))
            .catch((e: unknown) => say(e, "Could not remove that category"));
        },
      },
    ]);
  }

  return (
    <SafeScreen>
      <View style={s.adder}>
        <View style={s.adderField}>
          <AppTextInput
            placeholder="New category — Beverages"
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
          style={s.adderButton}
        />
      </View>

      {isLoading ? (
        <View style={s.list}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={56} borderRadius={14} />
          ))}
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(cat) => cat.id}
          contentContainerStyle={[s.list, (data ?? []).length === 0 ? s.listEmpty : null]}
          ListEmptyComponent={
            <EmptyState
              icon={TagIcon}
              tone="muted"
              title="No categories yet"
              message="Group your menu so customers can find things — Starters, Drinks, Deals."
            />
          }
          renderItem={({ item }) => {
            const editing = editingId === item.id;
            return (
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
                    <Text style={s.name} numberOfLines={1}>
                      {item.name}
                    </Text>
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
                      onPress={() => confirmRemove(item.id, item.name)}
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
    adderButton: { marginTop: 0 },
    list: { padding: spacing.md, gap: spacing.sm },
    listEmpty: { flexGrow: 1, justifyContent: "center" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      minHeight: 56,
    },
    rowField: { flex: 1 },
    name: { ...typography.body, fontSize: 16, color: c.text, flex: 1 },
    iconButton: { padding: 6 },
  });
