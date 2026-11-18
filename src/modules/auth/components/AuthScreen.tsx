import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { Gradient } from "../../../common/ui/Gradient";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { StorefrontIcon } from "../../../common/ui/icons";
import { BRAND } from "../../../common/brand";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";

/**
 * THE FRAME SIGN-IN AND SIGN-UP SHARE.
 *
 * "Login screen still not good": it was a grey page with the brand's name in
 * small capitals and a form floating in the middle of it — nothing that said
 * which app this was or why to sign in. The marketplace shape is a brand block
 * at the top (the mark, the name, one line of what you get) and the form on a
 * sheet that rises over it, with a way to skip and keep browsing — a guest can
 * use the whole app until the moment an order needs a name on it.
 */
export function AuthScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const canSkip = navigation.canGoBack();

  return (
    <SafeScreen backgroundColor={c.gradient[0]} edges={["top"]}>
      <FocusedStatusBar background={c.gradient[0]} />
      <KeyboardScreen contentStyle={styles.content}>
        <Gradient direction="vertical" style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.mark}>
              <StorefrontIcon size={26} color={c.primary} />
            </View>
            {canSkip && (
              <Pressable
                style={styles.skip}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Skip for now"
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.brand}>{BRAND.name}</Text>
          <Text style={styles.tagline}>Food, groceries and medicine from the shops near you.</Text>
        </Gradient>

        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {children}
        </View>
      </KeyboardScreen>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    content: { flexGrow: 1 },
    hero: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      // Room for the sheet's rounded top to rise into.
      paddingBottom: spacing.xl + spacing.lg,
      gap: spacing.xs,
    },
    heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
    mark: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    skip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: "rgba(255,255,255,0.18)",
    },
    skipText: { ...typography.label, color: c.textInverse },
    brand: { ...typography.display, color: c.textInverse },
    // The inverse ink, softened — `inkMuted` measured too faint on the deep stop.
    tagline: { ...typography.body, color: c.textInverse, opacity: 0.82 },
    sheet: {
      flexGrow: 1,
      marginTop: -spacing.lg,
      backgroundColor: c.bg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },
    title: { ...typography.title, color: c.text },
    subtitle: { ...typography.body, color: c.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  });
