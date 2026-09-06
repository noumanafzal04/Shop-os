import React, { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "../../../common/ui/icons";
import {
  EnvelopeIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { Touchable } from "../../../common/ui/Touchable";
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
    a: "Open Orders and tap the order to see where it is. That screen says how long ago it last checked and has a refresh button beside the title, so you can ask again without leaving it. The shop's phone number is there too — for anything about the food or the goods themselves, the shop is the quickest answer.",
  },
  {
    q: "What is the 4-digit code on my order?",
    a: "It appears once a rider is on the way, and they ask for it at your door. It is how the app knows your order actually reached you rather than somebody else — so read it out only when you have the order in your hands. Nobody will ever ask for it over the phone.",
  },
  {
    q: "Can I see where my rider is?",
    a: "Once they have collected your order, their name shows on the order screen along with how far along they are. If their phone is reporting its position you will see a Live marker; if it is not, we would rather show nothing than a pin from ten minutes ago.",
  },
  {
    q: "How do I rate a shop?",
    a: "Open the order once it has been delivered \u2014 the button is at the foot of it. Pick a star, add words if you want to, and post. One review per shop: posting again on the same shop replaces what you said before rather than adding a second.",
  },
  {
    q: "Can I change or delete a review?",
    a: "Yes, any time. Account \u2192 My reviews lists every shop you have rated, what you said, and anything the shop wrote back. Edit changes it, Remove takes it off their page entirely.",
  },
  {
    q: "How do I change my password?",
    a: "Account \u2192 Security. You need the one you use now, and the new one has to be at least 8 characters and different from the old. Changing it signs out every OTHER device straight away \u2014 this phone stays signed in.",
  },
  {
    q: "Someone else may have my password",
    a: "Account \u2192 Security shows every device signed in to your account, when each was last used, and which one is the phone you are holding. Sign out the ones you do not recognise, then change your password. If you are not sure which is which, Sign out everywhere ends all of them \u2014 including this phone \u2014 and you sign back in once.",
  },
  {
    q: "Which version am I running?",
    a: "It is at the foot of the Account page, under App. Worth reading out if you are reporting something that looks wrong \u2014 it is how we know whether the problem is already fixed in a newer build.",
  },
  {
    q: "What does the crossed-out price mean?",
    a: "The shop is running a sale. The bold price is what you pay; the one struck through beside it is what the item normally costs, and the amber tag on the picture says how much is off. If there is no struck-through price, the item is at its normal price — a shop cannot show a discount it is not giving.",
  },
  {
    q: "Where is my order right now?",
    a: "Open Orders. Anything still moving sits at the top under Ongoing, with a bar showing how far along it is — placed, accepted, being prepared, ready, on the way. Tap it to follow the rider on the map and to see the four digits they will ask for at the door.",
  },
  {
    q: "Why does my basket empty when I add something from another shop?",
    a: "One order goes to one shop, so it can be prepared and brought in one delivery. The app always asks before it clears the basket, and pressing Keep my basket leaves it exactly as it was.",
  },
  {
    q: "Can I deliver orders myself?",
    a: "Yes. Open the menu and tap Become a rider — it is the same account you shop with, so there is nothing new to install. You choose your vehicle, photograph your CNIC and licence, and send it in. Somebody checks it, usually within a day. Once you are approved a Rider mode appears in the same menu: go online when you want to work, take deliveries near you, and go offline when you are done.",
  },
  {
    q: "I am a rider — why don't I see every job?",
    a: "A delivery is offered to the riders nearest the shop first and widens outwards — three kilometres straight away, six after half a minute, then as far as that kind of shop reasonably reaches. So a job you cannot see is one somebody closer is being asked about first. Wait a moment and it may appear; if somebody nearer takes it, it will not. Keeping your location on is what puts you in the first ring.",
  },
  {
    q: "I am a rider — how do I get paid?",
    a: "You earn the delivery fee on each order you complete; Earnings in the menu shows what you have made. Cash you collect at the door is the SHOP'S money, not yours — it is shown separately as Cash in hand, and the shop marks it settled when you hand it over.",
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
          <ArrowLeftIcon size={19} color={c.text} />
        </Pressable>
        <Text style={styles.title}>Help centre</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {TOPICS.map((t, i) => {
          const isOpen = open === i;
          return (
            <Touchable
              key={t.q}
              style={[styles.item, isOpen && styles.itemOpen]}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              onPress={() => setOpen(isOpen ? null : i)}
            >
              <View style={styles.qRow}>
                <Text style={styles.q}>{t.q}</Text>
                {isOpen ? (
                  <ChevronUpIcon size={17} color={c.primary} />
                ) : (
                  <ChevronDownIcon size={17} color={c.textMuted} />
                )}
              </View>
              {isOpen && <Text style={styles.a}>{t.a}</Text>}
            </Touchable>
          );
        })}

        <Pressable
          style={styles.contact}
          accessibilityRole="button"
          onPress={() => {
            Linking.openURL(`https://${BRAND.domain}`).catch(() => {});
          }}
        >
          <EnvelopeIcon size={17} color={c.primary} />
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
      borderRadius: 19,
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
