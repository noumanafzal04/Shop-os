import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  QuoteIcon,
  StarIcon,
  StorefrontIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { Touchable } from "../../../common/ui/Touchable";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { Appear } from "../../../common/ui/Appear";
import { confirm } from "../../../common/ui/confirm";
import { toast } from "../../../common/ui/toast";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { RateSheet } from "../components/RateSheet";
import { useDeleteReview, useMyReviews } from "../hooks/useReviews";
import type { MyReview } from "../services/reviewService";

/**
 * MY REVIEWS.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 *
 * `GET /customer/reviews` and `DELETE /customer/reviews/{id}` have been
 * written, correct and reachable by nobody: the phone app called neither. So a
 * customer could post a review and then had no way to find it, change it or
 * take it down — on a public page carrying their name.
 *
 * That is the same defect this project has now found several times: an
 * endpoint whose screen was never built, passing every test it has because
 * tests call endpoints and people press screens.
 *
 * ── The shop's reply is on the row ───────────────────────────────────
 *
 * A shop replying to a review is a conversation, and until this screen the
 * customer's half of it was write-only: the reply appeared on the public page
 * and the person it answered had no reason ever to look there again.
 */

export function ReviewsScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();

  const reviews = useMyReviews();
  const pull = usePullToRefresh(reviews.refetch);
  const remove = useDeleteReview();
  const [editing, setEditing] = React.useState<MyReview | null>(null);

  const askRemove = (r: MyReview) => {
    confirm
      .ask({
        title: "Remove this review?",
        message: `Your rating of ${r.shop_name ?? "this shop"} comes off their page.`,
        confirmLabel: "Remove",
        cancelLabel: "Keep it",
        tone: "danger",
      })
      .then((yes) => {
        if (!yes) return;
        remove.mutate(r.id, { onSuccess: () => toast.success("Review removed") });
      })
      .catch(() => {});
  };

  const rows = reviews.data ?? [];

  return (
    <SafeScreen backgroundColor={c.bg}>
      <ScreenHeader
        title="My reviews"
        subtitle={
          reviews.isPending
            ? undefined
            : `${rows.length} shop${rows.length === 1 ? "" : "s"} rated`
        }
      />

      {reviews.isError ? (
        <LoadFailed
          what="your reviews"
          error={reviews.error}
          onRetry={() => reviews.refetch()}
          retrying={reviews.isFetching}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          ListEmptyComponent={
            reviews.isPending ? (
              <View style={styles.loading}>
                <SkeletonListRow />
                <SkeletonListRow />
              </View>
            ) : (
              <View style={styles.empty}>
                <QuoteIcon size={34} color={c.textMuted} />
                <Text style={styles.emptyTitle}>Nothing rated yet</Text>
                <Text style={styles.emptyText}>
                  When an order is delivered, the order screen offers to rate the
                  shop. It takes one tap.
                </Text>
              </View>
            )
          }
          renderItem={({ item, index }) => (
            <Appear index={index}>
              <View style={styles.card}>
                <Touchable
                  style={styles.head}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.shop_name ?? "shop"}`}
                  disabled={item.shop_slug == null}
                  onPress={() =>
                    item.shop_slug &&
                    navigation.navigate("MarketShop", { slug: item.shop_slug })
                  }
                >
                  <View style={styles.mark}>
                    <StorefrontIcon size={17} color={c.primary} />
                  </View>
                  <View style={styles.headCopy}>
                    <Text style={styles.shop} numberOfLines={1}>
                      {item.shop_name ?? "A shop"}
                    </Text>
                    <View style={styles.stars}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <StarIcon
                          key={n}
                          size={13}
                          color={n <= item.rating ? c.warm : c.border}
                        />
                      ))}
                    </View>
                  </View>
                </Touchable>

                {!!item.comment && <Text style={styles.comment}>{item.comment}</Text>}

                {/*
                  THE SHOP'S ANSWER, where the person it answers will see it.
                  It was only ever on the public page, which is the one place
                  they had no reason to go back to.
                */}
                {!!item.reply && (
                  <View style={styles.reply}>
                    <Text style={styles.replyWho}>
                      {item.shop_name ?? "The shop"} replied
                    </Text>
                    <Text style={styles.replyText}>{item.reply}</Text>
                  </View>
                )}

                <View style={styles.actions}>
                  <Touchable
                    style={styles.action}
                    accessibilityRole="button"
                    accessibilityLabel="Edit this review"
                    disabled={item.shop_slug == null}
                    onPress={() => setEditing(item)}
                  >
                    <Text style={styles.actionText}>Edit</Text>
                  </Touchable>
                  <Touchable
                    style={styles.action}
                    accessibilityRole="button"
                    accessibilityLabel="Remove this review"
                    onPress={() => askRemove(item)}
                  >
                    <Text style={[styles.actionText, styles.remove]}>Remove</Text>
                  </Touchable>
                </View>
              </View>
            </Appear>
          )}
        />
      )}

      {editing?.shop_slug != null && (
        <RateSheet
          visible
          onClose={() => setEditing(null)}
          shopSlug={editing.shop_slug}
          shopName={editing.shop_name ?? "this shop"}
          existing={{ rating: editing.rating, comment: editing.comment }}
        />
      )}
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
    loading: { gap: spacing.sm },

    card: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    mark: {
      width: 38,
      height: 38,
      borderRadius: 13,
      backgroundColor: c.brand[50],
      alignItems: "center",
      justifyContent: "center",
    },
    headCopy: { flex: 1, gap: 3 },
    shop: { ...typography.label, color: c.text, fontSize: 15 },
    stars: { flexDirection: "row", gap: 2 },

    comment: { ...typography.body, color: c.textSecondary, fontSize: 14, lineHeight: 20 },

    reply: {
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.md,
      padding: spacing.sm,
      gap: 2,
    },
    replyWho: { ...typography.tiny, color: c.primary, fontWeight: "800" },
    replyText: { ...typography.small, color: c.textSecondary, lineHeight: 18 },

    actions: {
      flexDirection: "row",
      gap: spacing.xs,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: spacing.sm,
    },
    action: { paddingVertical: 4, paddingHorizontal: 10 },
    actionText: { ...typography.small, color: c.primary, fontWeight: "700" },
    remove: { color: c.error },

    empty: { alignItems: "center", gap: 6, paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
    emptyTitle: { ...typography.h3, color: c.text, marginTop: spacing.sm },
    emptyText: { ...typography.small, color: c.textSecondary, textAlign: "center", lineHeight: 19 },
  });
