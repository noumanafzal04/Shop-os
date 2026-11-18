import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MinusIcon, PlusIcon, TrashIcon } from "../../../common/ui/icons";
import { type ThemeColors, typography, useColors } from "../../../theme";

/**
 * − 1 + — WHAT THE "+" BECOMES ONCE THE ITEM IS IN THE CART.
 *
 * The menu row kept showing a bare "+" after the first tap, so the only way
 * to know how many were in the basket was to open the basket. Every
 * marketplace of this shape turns the button into the count it controls, on
 * the row itself: one more, one fewer, without leaving the menu.
 *
 * At one, the minus is a bin — the next tap takes the line out, and saying so
 * beforehand is the difference between "remove" and an accident.
 */
export function QtyStepper({
  value,
  onMinus,
  onPlus,
  label,
  plusDisabled = false,
  display,
  last,
}: {
  /** The next minus takes the line out (default: at one). */
  last?: boolean;
  value: number;
  /** What to print instead of the bare number — "0.5 kg" for an item sold by weight. */
  display?: string;
  onMinus: () => void;
  onPlus: () => void;
  /** What is being counted, for the screen reader: "Garlic Naan". */
  label: string;
  plusDisabled?: boolean;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const removes = last ?? value <= 1;

  return (
    <View style={styles.pill}>
      <Pressable
        style={styles.btn}
        hitSlop={6}
        onPress={onMinus}
        accessibilityRole="button"
        accessibilityLabel={removes ? `Remove ${label}` : `One fewer ${label}`}
      >
        {removes ? <TrashIcon size={15} color={c.primary} /> : <MinusIcon size={15} color={c.primary} />}
      </Pressable>
      <Text style={styles.count} accessibilityLabel={`${value} in cart`}>
        {display ?? value}
      </Text>
      <Pressable
        style={[styles.btn, plusDisabled && styles.off]}
        hitSlop={6}
        onPress={onPlus}
        disabled={plusDisabled}
        accessibilityRole="button"
        accessibilityLabel={`One more ${label}`}
      >
        <PlusIcon size={15} color={c.primary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      height: 34,
      borderRadius: 17,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 2,
    },
    btn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    off: { opacity: 0.35 },
    count: { ...typography.label, color: c.text, minWidth: 18, paddingHorizontal: 2, textAlign: "center", fontVariant: ["tabular-nums"] },
  });
