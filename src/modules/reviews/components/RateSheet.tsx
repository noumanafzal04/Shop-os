import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Star } from "lucide-react-native";
import { BottomSheet } from "../../../common/ui/BottomSheet";
import { AppButton } from "../../../common/ui/AppButton";
import { Touchable } from "../../../common/ui/Touchable";
import { toast } from "../../../common/ui/toast";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useSaveReview } from "../hooks/useReviews";

/**
 * RATING A SHOP.
 *
 * ── Why this is a sheet and not a screen ─────────────────────────────
 *
 * It is opened from two places that are both somewhere else on the way to
 * something: a finished order, and the list of reviews already written. A push
 * would take the order away to ask two questions and then have to put it back.
 *
 * ── One review per shop ──────────────────────────────────────────────
 *
 * The server upserts, so posting again REPLACES rather than adds. The button
 * says "Update review" when one exists, because a person who thinks they are
 * adding a second and finds their first gone has been misled by the button,
 * and the fault would be here rather than in the endpoint.
 *
 * ── The comment is optional and the star is not ──────────────────────
 *
 * A rating with no words is a complete answer and the commonest one. Words
 * with no rating are not — the shop's average is what the marketplace sorts
 * and filters on, and a review that cannot move it is a review the shop
 * cannot act on.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  shopSlug: string;
  shopName: string;
  /** What they said last time, if they have said anything. */
  existing?: { rating: number; comment: string | null } | null;
}

const WORDS = ["", "Poor", "Not great", "Fine", "Good", "Excellent"];

export function RateSheet({ visible, onClose, shopSlug, shopName, existing }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const save = useSaveReview();

  const [rating, setRating] = React.useState(existing?.rating ?? 0);
  const [comment, setComment] = React.useState(existing?.comment ?? "");

  /**
   * Reset when the sheet OPENS, not on every render.
   *
   * Without the `visible` guard, typing a comment and having the list refetch
   * underneath would throw the words away mid-sentence.
   */
  React.useEffect(() => {
    if (!visible) return;
    setRating(existing?.rating ?? 0);
    setComment(existing?.comment ?? "");
  }, [visible, existing?.rating, existing?.comment]);

  const submit = () => {
    save.mutate(
      { shop_slug: shopSlug, rating, comment: comment.trim() || null },
      {
        onSuccess: () => {
          toast.success(existing ? "Review updated" : "Thanks for your review");
          onClose();
        },
      },
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={existing ? "Update your review" : `How was ${shopName}?`}
      footer={
        <AppButton
          title={
            save.isPending ? "Sending…" : existing ? "Update review" : "Post review"
          }
          onPress={submit}
          loading={save.isPending}
          // A star is the whole answer; without one there is nothing to send.
          disabled={rating < 1}
          size="lg"
        />
      }
    >
      <View style={styles.body}>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => {
            const on = n <= rating;
            return (
              <Touchable
                key={n}
                hitSlop={6}
                scaleTo={0.88}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${n} star${n === 1 ? "" : "s"}`}
                onPress={() => setRating(n)}
              >
                <Star
                  size={38}
                  color={on ? c.warm : c.border}
                  // Filled rather than outlined once it is chosen: five hollow
                  // stars and four hollow stars look the same at a glance.
                  fill={on ? c.warm : "transparent"}
                  strokeWidth={1.6}
                />
              </Touchable>
            );
          })}
        </View>

        <Text style={styles.word}>
          {rating > 0 ? WORDS[rating] : "Tap a star"}
        </Text>

        <TextInput
          style={styles.comment}
          placeholder="Anything you want to add? (optional)"
          placeholderTextColor={c.textMuted}
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={1000}
          textAlignVertical="top"
        />

        <Text style={styles.note}>
          Your name is shown with it. You can change or remove it any time from
          Account → My reviews.
        </Text>
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.sm },
    stars: {
      flexDirection: "row",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    word: {
      ...typography.label,
      color: c.text,
      textAlign: "center",
      fontSize: 15,
      marginBottom: spacing.xs,
    },
    comment: {
      ...typography.body,
      color: c.text,
      minHeight: 96,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      backgroundColor: c.surfaceAlt,
      padding: spacing.sm,
    },
    note: { ...typography.tiny, color: c.textMuted, lineHeight: 16 },
  });
