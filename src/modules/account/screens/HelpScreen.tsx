import React, { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, ChevronDown, ChevronUp, Mail } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { BRAND } from "../../../common/brand";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";

/**
 * Help, for the person doing the ordering.
 *
 * Deliberately NOT the shop-side Help Centre in the web panel: that one
 * answers "how do I run my till". These are the questions a customer asks, and
 * every answer here describes behaviour this app actually has — the cancel
 * rule, cash on delivery, the prescription refusal. If one of those rules
 * changes, this copy is part of the change.
 */

interface Topic {
  q: string;
  a: string;
}

const TOPICS: Topic[] = [
  {
    q: "How do I place an order?",
    a: "Pick a shop, add what you want to your basket, then open the basket and press Checkout. You choose delivery or pickup, confirm your address, and place the order. You will need an account so the shop knows who to deliver to.",
  },
  {
    q: "How do I pay?",
    a: "Cash on delivery. You pay the rider — or the counter, if you are collecting — when you get your order. Nothing is charged before then and no card is stored.",
  },
  {
    q: "Can I cancel an order?",
    a: "Yes, while it is still waiting for the shop to accept it. Once the shop has accepted, the food is being made or the goods are being picked, so cancelling from the app is switched off — call the shop and they can cancel it at their end.",
  },
  {
    q: "Why can I only order from one shop at a time?",
    a: "Each order goes to one shop, which is what lets it be prepared and delivered as one delivery. Adding something from a different shop starts a new basket, and the app asks first.",
  },
  {
    q: "Why can't I add some medicines?",
    a: "Medicines marked Rx are prescription-only. Pakistani law does not allow a pharmacy to hand them over without a prescription, so they cannot be ordered through the app. Visit the pharmacy with your prescription.",
  },
  {
    q: "How much is delivery?",
    a: "It is set by each shop and shown in your basket before you check out. Some shops deliver free above a certain amount — the basket tells you how much more is needed.",
  },
  {
    q: "Where do I put a coupon code?",
    a: "On the checkout screen, in the Coupon box. It is checked when the order is placed, and the discount appears on the order.",
  },
  {
    q: "My order has not arrived",
    a: "Open Orders and tap the order to see where it is. The shop's phone number is on that screen — for anything about the food or the goods themselves, the shop is the quickest answer.",
  },
];

export function HelpScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.head}>
        <Pressable
          style={styles.back}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
        >
          <ArrowLeft size={19} color={c.text} strokeWidth={2.3} />
        </Pressable>
        <Text style={styles.title}>Help centre</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {TOPICS.map((t, i) => {
          const isOpen = open === i;
          return (
            <Pressable
              key={t.q}
              style={[styles.item, isOpen && styles.itemOpen]}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              onPress={() => setOpen(isOpen ? null : i)}
            >
              <View style={styles.qRow}>
                <Text style={styles.q}>{t.q}</Text>
                {isOpen ? (
                  <ChevronUp size={17} color={c.primary} strokeWidth={2.4} />
                ) : (
                  <ChevronDown size={17} color={c.textMuted} strokeWidth={2.4} />
                )}
              </View>
              {isOpen && <Text style={styles.a}>{t.a}</Text>}
            </Pressable>
          );
        })}

        <Pressable
          style={styles.contact}
          accessibilityRole="button"
          onPress={() => {
            Linking.openURL(`https://${BRAND.domain}`).catch(() => {});
          }}
        >
          <Mail size={17} color={c.primary} strokeWidth={2.2} />
          <Text style={styles.contactText}>Still stuck? Visit {BRAND.domain}</Text>
        </Pressable>
      </ScrollView>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    back: {
      width: 38,
      height: 38,
      borderRadius: radius.full,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { ...typography.title, color: c.text },

    body: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
    item: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    itemOpen: { borderColor: c.primary },
    qRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    q: { ...typography.label, color: c.text, fontSize: 14.5, flex: 1 },
    a: { ...typography.small, color: c.textSecondary, marginTop: spacing.sm, lineHeight: 20 },

    contact: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
      paddingVertical: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: c.border,
    },
    contactText: { ...typography.small, color: c.primary, fontWeight: "700" },
  });
