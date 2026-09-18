import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Touchable } from "@cartze/core/ui/Touchable";
import { SmartImage } from "@cartze/core/ui/SmartImage";
import { money, qtyText } from "@cartze/core/format";
import { BoxIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import type { Product } from "../services/catalogService";

/**
 * ONE ITEM, AND THE ONE THING MOST OFTEN DONE TO IT.
 *
 * ── Why "sold out" is on the row and not inside the form ─────────────
 *
 * Because of how often it happens and when. Running out is the commonest edit
 * a shop makes to its own menu, it happens mid-service, and the alternative is
 * open the item, find the control, change it, save, go back — five actions for
 * a fact that takes one word to say. Everything else about a product is
 * occasional and belongs behind a tap.
 *
 * The toggle is a button with a LABEL, not a switch. A switch asks which way
 * is on; "Sold out" / "Put back" says what pressing it does.
 */
export function ProductRow({
  product,
  onPress,
  onToggleSoldOut,
}: {
  product: Product;
  onPress: () => void;
  onToggleSoldOut: () => void;
}) {
  const c = useColors();
  const s = styles(c);

  const off = product.sold_out_at !== null;
  const photo = product.images?.[0];
  const uri = photo?.url ?? null;

  return (
    <View style={[s.row, off ? s.rowOff : null]}>
      <Touchable onPress={onPress} accessibilityRole="button" style={s.main}>
        <View style={s.thumbWrap}>
          {uri ? (
            <SmartImage uri={uri} style={s.thumb} />
          ) : (
            <View style={[s.thumb, s.thumbEmpty]}>
              <BoxIcon size={18} color={c.textMuted} />
            </View>
          )}
        </View>

        <View style={s.body}>
          <Text style={[s.name, off ? s.nameOff : null]} numberOfLines={1}>
            {product.name}
          </Text>
          <Text style={s.meta} numberOfLines={1}>
            {money(product.price)}
            {product.track_inventory && product.stock_quantity != null
              ? ` · ${qtyText(product.stock_quantity)} in stock`
              : ""}
            {!product.is_active ? " · Hidden" : ""}
          </Text>
        </View>
      </Touchable>

      <Touchable
        onPress={onToggleSoldOut}
        accessibilityRole="button"
        accessibilityLabel={off ? `Put ${product.name} back on the menu` : `Mark ${product.name} sold out`}
        style={[s.toggle, off ? s.toggleOff : null]}
      >
        <Text style={[s.toggleText, off ? s.toggleTextOff : null]}>
          {off ? "Put back" : "Sold out"}
        </Text>
      </Touchable>
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingLeft: spacing.sm,
      paddingRight: spacing.sm,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    /**
     * Dimmed, not hidden. An item that is off is still on the menu tomorrow,
     * and a list that removes it leaves somebody hunting for the thing they
     * just switched off.
     */
    rowOff: { backgroundColor: c.surfaceAlt },
    main: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
    thumbWrap: { width: 46, height: 46 },
    // Not `radius.full`: 9999 renders square on a view this size under Fabric.
    thumb: { width: 46, height: 46, borderRadius: 10, backgroundColor: c.surfaceAlt },
    thumbEmpty: { alignItems: "center", justifyContent: "center" },
    body: { flex: 1, gap: 2 },
    name: { ...typography.body, fontSize: 16, color: c.text },
    nameOff: { color: c.textSecondary },
    meta: { ...typography.small, color: c.textMuted },
    toggle: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderRadius: 10,
      backgroundColor: c.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    toggleOff: { backgroundColor: c.primary, borderColor: c.primary },
    toggleText: { ...typography.label, fontSize: 13, color: c.textSecondary },
    toggleTextOff: { color: c.onPrimary },
  });
