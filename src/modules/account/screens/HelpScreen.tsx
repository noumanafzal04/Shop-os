import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { Touchable } from "@cartze/core/ui/Touchable";
import { ChevronDownIcon, ChevronUpIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { BRAND } from "../../../common/brand";
import { useAuthStore } from "../../../stores/authStore";

/**
 * QUESTIONS A SHOPKEEPER ASKS, filtered to what their shop actually has.
 *
 * STANDING RULE in this codebase: a code change updates the help. The panel's
 * is `panel/src/modules/help/content.ts`, the customer app's is its own
 * `HelpScreen.tsx`, and this is the third. It is not optional, and it is the
 * first thing that rots — six phases shipped before this file had a word in
 * it.
 *
 * ── Why topics are gated ─────────────────────────────────────────────
 *
 * A cashier with no `reports.view` cannot open the Money tab, and answering
 * "where do I see my earnings" for them is a page describing a door they
 * cannot walk through. The gate is the SAME string the tab uses, checked
 * against the server's own permission list by `tabsFor.test.ts`.
 */
interface Topic {
  q: string;
  a: string;
  /** Absent = everybody sees it. */
  permission?: string;
  /** Absent = no module gate. */
  module?: string;
}

const TOPICS: Topic[] = [
  {
    q: "What is this app for?",
    a: `${BRAND.name} is your shop on your phone: today's takings, the orders waiting for you, and your menu. Everything else — adding products, staff, reports, invoices — stays in the ${BRAND.family} web panel, which has the room for it.`,
  },
  {
    q: "Who can sign in?",
    a: "You, and anyone you have added as staff in the web panel, using the same email or phone and password. What each person sees here is what their permissions allow — a cashier will not see Money, and only an owner can change shop settings.",
  },

  // ── Orders ────────────────────────────────────────────────────────
  {
    q: "How do I accept an order?",
    a: "Open Orders, tap the one you want, and press the button at the bottom. It always shows the NEXT step — Accept order, then Start preparing, then Send out or Ready for collection, then Complete. You never have to remember what comes next.",
    permission: "orders.manage",
    module: "products",
  },
  {
    q: "Why does one order say 'Send out' and another 'Ready for collection'?",
    a: "Because one is being delivered and the other collected. A collection order is never offered the delivery step — a customer standing at your counter should not be told their food is on a bike.",
    permission: "orders.manage",
    module: "products",
  },
  {
    q: "What does 'No rider assigned' mean?",
    a: "The order is marked out for delivery but nobody is carrying it — a customer waiting for a bike that was never sent. Assign a rider in the web panel, or switch the order back a step.",
    permission: "orders.manage",
    module: "products",
  },
  {
    q: "Can I cancel an order?",
    a: "Yes, from the order screen — the quiet link under the main button. The customer is told, and any stock the order was holding goes back. It cannot be undone, which is why it is not a button beside Accept.",
    permission: "orders.manage",
    module: "products",
  },
  {
    q: "Why is the order number in the app different from the till?",
    a: "They are different things. An online or phone order gets an order number; a sale rung at the till gets a receipt number. An order becomes a sale when you complete it.",
    permission: "orders.manage",
    module: "products",
  },

  // ── Menu ──────────────────────────────────────────────────────────
  {
    q: "Something has run out — what do I do?",
    a: "Open Menu, find it, and press Sold out on its row. It comes off straight away for customers ordering online. Press Put back when you have it again. Nothing else about the product changes, and the price and stock stay as they were.",
    permission: "products.manage",
    module: "products",
  },
  {
    q: "Does 'Sold out' affect my other branches?",
    a: "No. It takes the item off at the branch you are working in. One branch running out never takes it off the whole chain.",
    permission: "products.manage",
    module: "products",
  },
  {
    q: "Can I add a new product here?",
    a: "Not yet — adding products, photos, categories and variants is in the web panel. Here you can change a name and a price, and take something off the menu. A form that asked for everything on a phone is one nobody finishes.",
    permission: "products.manage",
    module: "products",
  },

  // ── Money ─────────────────────────────────────────────────────────
  {
    q: "What does the big number on Money mean?",
    a: "Sales for the period you picked, with that period's refunds already taken off — what actually came in. Below it the same figures are broken down, ending in net profit, which is after cost of goods and expenses.",
    permission: "reports.view",
  },
  {
    q: "Why is 'Taken today' different from my net profit?",
    a: "Taken today is money in. Net profit is what is left after what the goods cost you and what you spent. Both are true; they answer different questions.",
    permission: "reports.view",
  },
  {
    q: "What is the CartZe commission?",
    a: `A share of what the marketplace sold for you, on ONLINE orders only. A walk-in at the till and a phone order you took yourself are sales ${BRAND.family} had no part in, and are never charged. Every charge is listed with the order it came from and the rate at the time, so you can check the total rather than take it on trust.`,
    permission: "reports.view",
  },
  {
    q: "How do I record something I paid for?",
    a: "Money, then Record an expense. Pick a category, say what it was for and how much. It is recorded against today — back-dating a correction belongs in the web panel where the whole month is visible.",
    permission: "reports.view",
  },

  // ── Shop ──────────────────────────────────────────────────────────
  {
    q: "How do I stop taking orders right now?",
    a: "There is no pause switch yet, and we would rather say so than pretend. Today, the only way is Account → Shop settings → Opening hours, and change today's closing time. Remember to put it back. A proper 'closed for now' is on the list.",
    permission: "settings.manage",
  },
  {
    q: "I set my hours and now the shop looks closed on other days",
    a: "Once ANY day has hours, a day with no times counts as closed. Set every day you open, not just the one you were changing. With no hours saved at all, the shop is treated as always open.",
    permission: "settings.manage",
  },
  {
    q: "What does an empty delivery radius mean?",
    a: "No limit — you deliver anywhere in your city. It is not the same as zero, which would mean nowhere. The same is true of minimum order and free-delivery amounts: empty means the rule is off.",
    permission: "settings.manage",
  },

  // ── Notifications ─────────────────────────────────────────────────
  {
    q: "I am not getting notifications for new orders",
    a: "Check that notifications are allowed for this app in your phone's settings — Android will not show them until you have said yes. Even with them off, the Orders screen refreshes by itself every few seconds while it is open, so nothing is lost; you just have to be looking.",
  },
  {
    q: "Someone else uses this phone — will they see my orders?",
    a: "Sign out from Account when you hand it over. That stops the notifications for your shop as well as closing your session.",
  },
];

export function HelpScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();
  const [open, setOpen] = useState<number | null>(0);

  const can = useAuthStore((st) => st.can);
  const features = useAuthStore((st) => st.user?.tenant?.features);

  const visible = TOPICS.filter(
    (t) => (!t.permission || can(t.permission)) && (!t.module || features?.[t.module] === true),
  );

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader title="Help" onBack={() => nav.goBack()} />

      <ScrollView contentContainerStyle={s.body}>
        {visible.map((t, i) => {
          const isOpen = open === i;
          return (
            <Touchable
              key={t.q}
              onPress={() => setOpen(isOpen ? null : i)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              style={[s.item, isOpen ? s.itemOpen : null]}
            >
              <View style={s.qRow}>
                <Text style={s.q}>{t.q}</Text>
                {isOpen ? (
                  <ChevronUpIcon size={17} color={c.primaryPressed} />
                ) : (
                  <ChevronDownIcon size={17} color={c.textMuted} />
                )}
              </View>
              {isOpen ? <Text style={s.a}>{t.a}</Text> : null}
            </Touchable>
          );
        })}

        <Text style={s.foot}>
          Still stuck? Everything in this app is also in the {BRAND.family} web panel at{" "}
          {BRAND.domain}, where there is more room to work.
        </Text>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
    item: {
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.sm,
    },
    itemOpen: { borderColor: c.primary },
    qRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    q: { ...typography.body, fontSize: 16, color: c.text, flex: 1, lineHeight: 22 },
    /** 22pt line height: this is the one place in the app somebody READS. */
    a: { ...typography.body, color: c.textSecondary, lineHeight: 22 },
    foot: {
      ...typography.small,
      color: c.textMuted,
      textAlign: "center",
      lineHeight: 19,
      marginTop: spacing.md,
    },
  });
