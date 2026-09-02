import { failed } from "../../../common/api/failed";
import { useToast } from "../../../components/ui/toast";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import Alert from "../../../components/ui/alert/Alert";
import Button from "../../../components/ui/button/Button";
import TextArea from "../../../components/form/input/TextArea";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import {
  useDeleteReview,
  useMyReviews,
  useShopReviews,
  useSubmitReview,
} from "../hooks/useMarketplace";
import { StarIcon } from "./MarketIcons";

export function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className={`inline-flex ${onChange ? "cursor-pointer select-none" : "select-none"}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type={onChange ? "button" : undefined}
          disabled={!onChange}
          onClick={onChange ? () => onChange(n) : undefined}
          aria-label={onChange ? `${n} star${n > 1 ? "s" : ""}` : undefined}
          className={n <= Math.round(value) ? "text-amber-400" : "text-gray-300 dark:text-gray-700"}
        >
          <StarIcon className={onChange ? "size-6" : "size-4"} filled={n <= Math.round(value)} />
        </button>
      ))}
    </span>
  );
}

/**
 * WHAT PEOPLE SAID ABOUT THIS SHOP, AND WHAT I SAID.
 *
 * Lifted out of the shop page whole. The behaviour it carries is worth keeping
 * intact rather than rewriting: the box refills with MY OWN words (a screen
 * that says "posting again updates it" and then shows an empty form is asking
 * somebody to rewrite from memory a review they cannot see), the row is marked
 * "Yours" because names repeat, and Remove exists because for a long time the
 * only way out of a review posted by mistake was to overwrite it with
 * something milder.
 */
export function ShopReviews({ slug, shopName }: { slug: string | undefined; shopName: string }) {
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const isCustomer = user?.role === "customer";

  const reviews = useShopReviews(slug);
  const myReviews = useMyReviews(isCustomer);
  const submitReview = useSubmitReview();
  const deleteReview = useDeleteReview(slug);
  const confirm = useConfirm();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  const mine = myReviews.data?.find((r) => r.shop_slug === slug) ?? null;
  const rows = reviews.data?.data ?? [];

  // Keyed on the review id so a fresh answer refills the box, but typing is
  // never overwritten while the query refetches.
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (mine === null || loaded.current === mine.id) return;
    loaded.current = mine.id;
    setRating(mine.rating);
    setComment(mine.comment ?? "");
  }, [mine]);

  const error =
    submitReview.error instanceof ApiError
      ? (submitReview.error.firstFieldError() ?? submitReview.error.message)
      : null;

  const send = () => {
    if (!slug || !rating || submitReview.isPending) return;
    submitReview.mutate({ shop_slug: slug, rating, comment: comment.trim() || undefined });
    // The box is deliberately not emptied. What is in it IS my review now, and
    // clearing it made an update look like it had been discarded.
  };

  const remove = async () => {
    if (mine === null || deleteReview.isPending) return;

    const ok = await confirm({
      title: "Remove your review?",
      message: `Your review of ${shopName} will be taken down, and the shop's rating will be worked out without it. You can write a new one any time.`,
      confirmLabel: "Remove review",
      tone: "danger",
    });
    if (!ok) return;

    deleteReview.mutate(mine.id, {
      ...failed(toast, "Your review is still there."),
      onSuccess: () => {
        loaded.current = null;
        setRating(0);
        setComment("");
      },
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-white">Reviews</h2>

        {reviews.isLoading ? (
          <div className="h-24 animate-pulse rounded-3xl bg-gray-100 dark:bg-white/5" />
        ) : rows.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-white/10 dark:text-gray-400">
            No reviews yet — be the first.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div
                key={r.id}
                className={
                  r.id === mine?.id
                    ? "rounded-3xl border border-brand-300 bg-brand-50/40 p-5 dark:border-brand-500/40 dark:bg-brand-500/[0.06]"
                    : "rounded-3xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900"
                }
              >
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                    {r.customer_name}
                    {r.id === mine?.id && (
                      <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-600 dark:text-brand-400">
                        Yours
                      </span>
                    )}
                  </span>
                  <Stars value={r.rating} />
                </div>
                {r.comment && <p className="text-sm text-gray-600 dark:text-gray-300">{r.comment}</p>}
                {r.reply && (
                  <div className="mt-3 rounded-2xl bg-gray-50 p-3 text-sm dark:bg-white/[0.03]">
                    <span className="font-medium text-brand-600 dark:text-brand-400">Shop reply:</span>{" "}
                    <span className="text-gray-600 dark:text-gray-300">{r.reply}</span>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-gray-400">
                  {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="h-fit rounded-3xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900">
        <h3 className="mb-3 font-bold text-gray-900 dark:text-white">
          {!isCustomer ? "Want to review?" : mine ? "Your review" : "Rate this shop"}
        </h3>

        {!isCustomer ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <Link to="/signin" className="font-medium text-brand-600">Sign in</Link> as a customer to leave
            a review. Posting again updates your existing one.
          </p>
        ) : (
          <>
            {error && (
              <div className="mb-3">
                <Alert variant="error" title="Couldn't post" message={error} />
              </div>
            )}

            <div className="mb-3">
              <Stars value={rating} onChange={setRating} />
            </div>

            <TextArea value={comment} onChange={setComment} rows={3} placeholder="Share your experience (optional)" />

            <Button size="sm" className="mt-3 w-full" onClick={send} disabled={submitReview.isPending || !rating}>
              {submitReview.isPending ? (mine ? "Saving…" : "Posting…") : mine ? "Update review" : "Post review"}
            </Button>

            {mine ? (
              <>
                <Button size="sm" variant="danger" className="mt-2 w-full" onClick={remove} disabled={deleteReview.isPending}>
                  {deleteReview.isPending ? "Removing…" : "Remove review"}
                </Button>
                {mine.reply && (
                  <p className="mt-2 text-[11px] text-gray-400">
                    The shop has replied to this. Changing it clears their reply.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-[11px] text-gray-400">One review per shop — posting again updates it.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
