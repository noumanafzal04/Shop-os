import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Input from "../../../components/form/input/InputField";
import Alert from "../../../components/ui/alert/Alert";
import Pager from "../../../components/ui/pager";
import { ApiError } from "../../../common/types/api";
import { apiGet, apiPost } from "../../../common/api/client";

interface OwnerReview {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  is_published: boolean;
  created_at: string;
  customer?: { id: string; name: string };
}

export default function OwnerReviewsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  // Ten a page, and until this took a page number a shop with eleven reviews
  // could never read the first one it ever got — nor reply to it.
  const reviews = useQuery({
    queryKey: ["owner-reviews", page],
    queryFn: () => apiGet<OwnerReview[]>("/reviews", { params: { page } }),
    placeholderData: keepPreviousData,
  });

  const summary = useQuery({
    queryKey: ["owner-reviews", "summary"],
    queryFn: async () =>
      (await apiGet<{ average: number | null; count: number }>("/reviews/summary")).data,
  });

  const reply = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiPost(`/reviews/${id}/reply`, { reply: text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["owner-reviews"] });
      setReplyFor(null);
      setReplyText("");
    },
  });

  const rows = reviews.data?.data ?? [];
  const replyError =
    reply.error instanceof ApiError
      ? reply.error.firstFieldError() ?? reply.error.message
      : null;

  return (
    <>
      <PageMeta title="Reviews | CartZe" description="Customer feedback" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Reviews</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {summary.data?.count
              ? `★ ${summary.data.average} average from ${summary.data.count} review(s)`
              : "What customers say about your shop"}
          </p>
        </div>
      </div>

      {replyError && (
        <div className="mb-4">
          <Alert variant="error" title="Couldn't reply" message={replyError} />
        </div>
      )}

      {reviews.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No reviews yet — they'll appear here once customers rate your shop.
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-800 dark:text-white/90">
                    {r.customer?.name ?? "Customer"}
                  </span>
                  <span className="text-warning-400">
                    {"★".repeat(r.rating)}
                    <span className="text-gray-300 dark:text-gray-700">{"★".repeat(5 - r.rating)}</span>
                  </span>
                  {!r.is_published && <Badge size="sm" color="light">hidden</Badge>}
                </div>
                <span className="text-theme-xs text-gray-400">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>

              {r.comment && <p className="text-sm text-gray-600 dark:text-gray-300">{r.comment}</p>}

              {r.reply ? (
                <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/[0.03]">
                  <span className="font-medium text-brand-600 dark:text-brand-400">Your reply:</span>{" "}
                  <span className="text-gray-600 dark:text-gray-300">{r.reply}</span>
                </div>
              ) : replyFor === r.id ? (
                <div className="mt-3 flex gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder="Write a public reply…"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => replyText.trim() && reply.mutate({ id: r.id, text: replyText.trim() })}
                    disabled={reply.isPending || !replyText.trim()}
                  >
                    {reply.isPending ? "Posting…" : "Reply"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setReplyFor(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  className="mt-3 text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
                  onClick={() => { setReplyFor(r.id); setReplyText(""); reply.reset(); }}
                >
                  Reply publicly
                </button>
              )}
            </div>
          ))}
          <Pager pagination={reviews.data?.meta?.pagination} onPage={setPage} noun="reviews" />
        </div>
      )}
    </>
  );
}
