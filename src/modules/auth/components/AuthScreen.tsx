import React from "react";
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from "react-native";
import { picture } from "../../marketplace/tradePicture";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { BRAND } from "../../../common/brand";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { switchAuth } from "../leaveAuth";

/**
 * THE FRAME SIGN-IN AND SIGN-UP SHARE.
 *
 * "Login signup still acha ni hai." The first pass was a gradient block with
 * the name in it and a form — correct, and it looked like a settings page with
 * a header. What the marketplace apps do on this screen is SELL the app for
 * one second before asking for anything: a picture of what you get (the
 * scooter, the food, the groceries, the medicine), then one sheet with a
 * switch between "Log in" and "Sign up" so nobody has to find a link to the
 * other form, and a way to skip and keep browsing — a guest can use all of it
 * until an order needs a name.
 */
export function AuthScreen({
  mode,
  title,
  subtitle,
  children,
}: {
  mode: "SignIn" | "SignUp";
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
    <SafeScreen backgroundColor={c.primary} edges={["top"]}>
      <FocusedStatusBar background={c.primary} />
      <KeyboardScreen contentStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.brand}>{BRAND.name}</Text>
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

          {/*
            What you get, as a picture: the delivery in the middle, the four
            kinds of thing it brings around it — the bundled 3D art (see
            `tradePicture.ts`), so it looks the same on every phone.
          */}
          <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.centre}>
              <Image source={picture("motor_scooter")} style={styles.centrePic} />
            </View>
            <Bubble styles={styles} art={picture("hamburger")} at={{ top: 6, left: "14%" }} />
            <Bubble styles={styles} art={picture("broccoli")} at={{ top: 0, right: "14%" }} />
            <Bubble styles={styles} art={picture("pill")} at={{ bottom: 6, left: "20%" }} />
            <Bubble styles={styles} art={picture("shopping_cart")} at={{ bottom: 0, right: "18%" }} />
          </View>
          <Text style={styles.tagline}>Food, groceries and medicine from the shops near you.</Text>
        </View>

        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          {/* One switch between the two forms — nobody hunts for a link. */}
          <View style={styles.segment} accessibilityRole="tablist">
            {(["SignIn", "SignUp"] as const).map((m) => {
              const on = m === mode;
              return (
                <Pressable
                  key={m}
                  style={[styles.seg, on && styles.segOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => !on && switchAuth(navigation, m)}
                >
                  <Text style={[styles.segText, on && styles.segTextOn]}>{m === "SignIn" ? "Log in" : "Sign up"}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {children}

          <Text style={styles.terms}>
            By continuing you agree to the {BRAND.name} terms of service and privacy policy.
          </Text>
        </View>
      </KeyboardScreen>
    </SafeScreen>
  );
}

function Bubble({
  styles,
  art,
  at,
}: {
  styles: ReturnType<typeof makeStyles>;
  art: ImageSourcePropType;
  at: { top?: number; bottom?: number; left?: number | `${number}%`; right?: number | `${number}%` };
}) {
  return (
    <View style={[styles.bubble, at]}>
      <Image source={art} style={styles.bubblePic} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    content: { flexGrow: 1 },
    hero: { backgroundColor: c.primary, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl + spacing.md },
    heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    brand: { ...typography.h3, color: c.textInverse, letterSpacing: 0.2 },
    skip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: "rgba(255,255,255,0.16)",
    },
    skipText: { ...typography.label, color: c.textInverse },
    art: { height: 180, marginTop: spacing.md, alignItems: "center", justifyContent: "center" },
    centre: {
      width: 132,
      height: 132,
      borderRadius: 66,
      backgroundColor: "rgba(255,255,255,0.14)",
      alignItems: "center",
      justifyContent: "center",
    },
    centrePic: { width: 96, height: 96 },
    bubble: {
      position: "absolute",
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    bubblePic: { width: 38, height: 38 },
    tagline: { ...typography.body, color: c.textInverse, opacity: 0.85, textAlign: "center", marginTop: spacing.md },
    sheet: {
      flexGrow: 1,
      marginTop: -spacing.lg,
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.lg + 8,
      borderTopRightRadius: radius.lg + 8,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },
    segment: {
      flexDirection: "row",
      backgroundColor: c.surfaceAlt,
      borderRadius: 24,
      padding: 4,
      marginBottom: spacing.lg,
    },
    seg: { flex: 1, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    segOn: { backgroundColor: c.primary },
    segText: { ...typography.label, color: c.textSecondary },
    segTextOn: { color: c.onPrimary },
    title: { ...typography.title, color: c.text },
    subtitle: { ...typography.body, color: c.textSecondary, marginTop: 4, marginBottom: spacing.lg },
    terms: { ...typography.caption, color: c.textMuted, textAlign: "center", marginTop: spacing.lg },
  });
