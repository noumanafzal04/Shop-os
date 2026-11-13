import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { type ThemeColors, typography, useColors } from "../../../theme";

/**
 * "FEATURED" — a shop that paid for its place says so.
 *
 * Wherever the card appears: the paid row at the top, and the same shop again
 * in the long list below. A paid place that is not labelled reads as the app
 * recommending it, and the customer is owed the difference.
 *
 * The brand's own tint, not the deal orange: orange on this app means a price
 * is cut, and a featured shop has bought position, not a discount. On a
 * photograph (`onImage`) the tag sits on a solid plate so it reads over any
 * picture.
 */
export function FeaturedTag({ onImage = false, style }: { onImage?: boolean; style?: object }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  return (
    <View
      style={[styles.tag, onImage && styles.onImage, style]}
      accessible
      accessibilityLabel="Featured shop"
    >
      <Text style={[styles.text, onImage && styles.onImageText]}>Featured</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    tag: {
      backgroundColor: c.primarySoft,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    text: { ...typography.micro, color: c.primary, fontWeight: "800", letterSpacing: 0.3 },
    onImage: { backgroundColor: c.primary },
    onImageText: { color: c.onPrimary },
  });
