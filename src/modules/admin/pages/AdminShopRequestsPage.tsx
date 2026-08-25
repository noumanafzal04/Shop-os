import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { apiGet, apiPost } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import Input from "../../../components/form/input/InputField";

/**
 * Demos asking to become businesses.
 *
 * ── Oldest first, and that is the whole design ─────────────────────────
 *
 * Nothing deletes a demo while its owner is waiting for an answer — the prune
 * skips a shop with a request outstanding — which is the right way round: the
 * person who just asked to stay must not lose their work because nobody has
 * replied yet. But it also means a slow reply costs the customer nothing and
 * costs this screen its only discipline. So the list is ordered by how long
 * somebody has been waiting, and how long the oldest has waited is printed
 * where it cannot be missed.
 */
type ShopRequest = {
  id: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  note: string | null;
  status: "pending" | "approved" | "declined";
  requested_at: string;
  decline_reason: string | null;
  tenant?: { id: string; business_name: string; business_type: string; slug: string } | null;
};

const daysWaiting = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/**
 * The whole phrase, built in one place.
 *
 * Assembled inline first — `{days || "less than a"} day{days === 1 ? "" : "s"}`
 * — which reads "less than a days" on the only day most requests are ever
 * looked at. Three fragments deciding one sentence between them is how that
 * happens; one function returning the sentence is how it stops.
 */
const howLong = (iso: string): string => {
  const days = daysWaiting(iso);
  if (days < 1) return "less than a day";

  return `${days} day${days === 1 ? "" : "s"}`;
};

/** "3 days" — and it is deliberately blunt once it is more than a couple. */
function Waiting({ since }: { since: string }) {
  const days = daysWaiting(since);
  if (days < 1) return <span className="text-gray-500 dark:text-gray-400">today</span>;

  return (
    <span className={days >= 3 ? "font-semibold text-error-600 dark:text-error-400" : "text-gray-500 dark:text-gray-400"}>
      waiting {howLong(since)}
    </span>
  );
}

export default function AdminShopRequestsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const [declining, setDeclining] = useState<ShopRequest | null>(null);
  const [reason, setReason] = useState("");

  const rows = useQuery({
    queryKey: ["admin", "shop-requests", status],
    queryFn: () => apiGet<ShopRequest[]>("/admin/shop-requests", { params: { status } }),
  });

  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: ["admin", "shop-requests"] });
  };
  const failed = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : "That did not go through.");

  const approve = useMutation({
    mutationFn: (id: string) => apiPost<unknown>(`/admin/shop-requests/${id}/approve`),
    onSuccess: ({ message }) => done(message ?? "Approved."),
    onError: failed,
  });

  const decline = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) =>
      apiPost<unknown>(`/admin/shop-requests/${id}/decline`, { reason: why }),
    onSuccess: ({ message }) => {
      done(message ?? "Declined.");
      setDeclining(null);
      setReason("");
    },
    onError: failed,
  });

  const list = rows.data?.data ?? [];
  const oldest = list.filter((r) => r.status === "pending")[0];

  return (
    <>
      <PageMeta title="Shop requests | CartZe" description="Demo shops asking to become businesses" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Shop requests</h1>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            {oldest
              // The number that says whether this screen is being run properly.
              ? <>Somebody has been waiting <strong>{howLong(oldest.requested_at)}</strong>.</>
              : "Nobody is waiting."}
          </p>
        </div>

        <div className="flex gap-1.5">
          {(["pending", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-1.5 text-theme-sm font-medium capitalize transition ${
                status === s
                  ? "bg-brand-500 text-white"
                  : "border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-white/15 dark:text-gray-300 dark:hover:bg-white/5"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {rows.isLoading && <p className="text-theme-sm text-gray-500">Loading…</p>}

      {!rows.isLoading && list.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            No requests. Demo shops clear themselves away on their own.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {list.map((r) => (
          <div key={r.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 dark:text-white/90">{r.contact_name}</p>
                <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                  <a href={`mailto:${r.contact_email}`} className="text-brand-500 hover:text-brand-600">{r.contact_email}</a>
                  {r.contact_phone ? ` · ${r.contact_phone}` : ""}
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                {r.status === "pending" ? <Waiting since={r.requested_at} /> : null}
                <Badge color={r.status === "approved" ? "success" : r.status === "declined" ? "error" : "warning"}>
                  {r.status}
                </Badge>
              </div>
            </div>

            <p className="text-theme-sm text-gray-600 dark:text-gray-300">
              {/* The shop they built. Named and linked, because the decision is
                  about what is already in it. */}
              {r.tenant ? (
                <Link to={`/admin/tenants/${r.tenant.id}`} className="font-medium text-brand-500 hover:text-brand-600">
                  {r.tenant.business_name}
                </Link>
              ) : <span className="text-gray-400">shop no longer exists</span>}
              {r.tenant?.business_type ? <span className="text-gray-400"> · {r.tenant.business_type}</span> : null}
            </p>

            {r.note ? <p className="mt-2 text-theme-sm italic text-gray-500 dark:text-gray-400">“{r.note}”</p> : null}
            {r.decline_reason ? (
              <p className="mt-2 text-theme-sm text-error-600 dark:text-error-400">Declined: {r.decline_reason}</p>
            ) : null}

            {r.status === "pending" && (
              <div className="mt-4 flex gap-2.5">
                <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeclining(r)}>
                  Decline
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal isOpen={declining !== null} onClose={() => setDeclining(null)} className="max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Decline this request</h3>
        <p className="mt-1.5 text-theme-sm text-gray-500 dark:text-gray-400">
          {/* Required by the server, and said here so it does not arrive as a
              validation error. A decline with no reason is a thing nobody can
              act on later, including whoever picks up the conversation. */}
          The shop stays a demo and ends on its own clock. Say why — whoever
          picks this up next will need it.
        </p>
        <Input
          className="mt-4"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Duplicate of an existing shop"
        />
        <div className="mt-5 flex justify-end gap-2.5">
          <Button size="sm" variant="outline" onClick={() => setDeclining(null)}>Cancel</Button>
          <Button
            size="sm"
            disabled={decline.isPending || reason.trim().length === 0}
            onClick={() => declining && decline.mutate({ id: declining.id, why: reason.trim() })}
          >
            Decline
          </Button>
        </div>
      </Modal>
    </>
  );
}
