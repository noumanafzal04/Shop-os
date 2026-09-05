import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet, apiPost } from "../../../common/api/client";
import { openAuthedFile } from "../../../common/api/download";
import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Pager from "../../../components/ui/pager";
import { FilterChips } from "../../../components/ui/filters";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import { ROW_ACTION } from "../../../components/ui/table/rowAction";

/**
 * WHO MAY RIDE.
 *
 * ── Why a person does this and not a form ────────────────────────────
 *
 * An approved rider stands at a stranger's door holding their dinner and, on a
 * cash order, their money. Nothing in an application proves anybody is who
 * they say they are; the photographs are the evidence, and somebody has to
 * look at them. This screen exists so that looking is a job with a queue,
 * rather than a thing that happens when a shop complains.
 *
 * ── The two verdicts that are not opposites ──────────────────────────
 *
 * REJECTED is about the paperwork: a blurred CNIC, a licence that expired.
 * It says what is wrong and the applicant fixes it and sends it again.
 *
 * SUSPENDED is about the person, and cannot be re-applied out of. Both need a
 * reason, and the reason is shown to the rider — a rejection nobody explains
 * is a dead end the applicant cannot do anything about, so they apply again
 * unchanged and the queue grows.
 */

type RiderDoc = {
  id: string;
  type: string;
  label: string;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  size_bytes: number;
  uploaded_at: string | null;
};

type RiderApplication = {
  id: string;
  rider_code: string;
  status: "draft" | "pending" | "approved" | "rejected" | "suspended";
  status_label: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  vehicle_type: string;
  vehicle_registration: string | null;
  cnic: string | null;
  is_platform: boolean;
  city: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  applied_at: string | null;
  approved_at: string | null;
  review_note: string | null;
  missing_documents: string[];
  documents: RiderDoc[];
};

const QUEUE = [
  { value: "pending" as const, label: "Waiting" },
  { value: "approved" as const, label: "Approved" },
  { value: "rejected" as const, label: "Rejected" },
  { value: "suspended" as const, label: "Suspended" },
  { value: "draft" as const, label: "Not sent" },
];

type Queue = (typeof QUEUE)[number]["value"];

const TONE: Record<RiderApplication["status"], "success" | "warning" | "error" | "light"> = {
  approved: "success",
  pending: "warning",
  rejected: "error",
  suspended: "error",
  draft: "light",
};

export default function AdminRidersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Queue>("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const rows = useQuery({
    queryKey: ["admin", "riders", status, search, page],
    queryFn: () =>
      apiGet<RiderApplication[]>("/admin/riders", {
        params: { status, search: search.trim() || undefined, page },
      }),
  });

  // The full record, including the CNIC number, fetched only when somebody has
  // deliberately opened ONE applicant. Down a list it stays masked.
  const detail = useQuery({
    queryKey: ["admin", "riders", "one", open],
    queryFn: async () => (await apiGet<RiderApplication>(`/admin/riders/${open}`)).data,
    enabled: open !== null,
  });

  const failed = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : "That did not go through.");

  const review = useMutation({
    mutationFn: ({ id, verdict, why }: { id: string; verdict: string; why?: string }) =>
      apiPost<unknown>(`/admin/riders/${id}/review`, { verdict, note: why }),
    onSuccess: ({ message }) => {
      toast.success(message ?? "Recorded.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "riders"] });
      setOpen(null);
      setNote("");
    },
    onError: failed,
  });

  const reviewDoc = useMutation({
    mutationFn: ({ id, docId, s, why }: { id: string; docId: string; s: string; why?: string }) =>
      apiPost<unknown>(`/admin/riders/${id}/documents/${docId}/review`, { status: s, note: why }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "riders"] });
    },
    onError: failed,
  });

  const list = rows.data?.data ?? [];
  const pagination = rows.data?.meta?.pagination;
  const person = detail.data;

  /**
   * Open a document.
   *
   * Through the axios instance, which carries the bearer token — these live on
   * the PRIVATE disk and there is no URL for them that works without one. That
   * is the point: a CNIC scan on the public disk would have a guessable
   * address that needs no login at all.
   */
  const viewDoc = (riderId: string, docId: string) => {
    openAuthedFile(`/admin/riders/${riderId}/documents/${docId}`).catch(() =>
      toast.error("That file could not be opened."),
    );
  };

  return (
    <>
      <PageMeta title="Riders | CartZe" description="Rider applications waiting for review" />

      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Riders</h1>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          People asking to carry deliveries. Check the photographs against the name before
          approving — an approved rider stands at customers' doors holding their money.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          ariaLabel="Rider queue"
          options={QUEUE}
          value={status}
          onChange={(v) => {
            setStatus(v as Queue);
            setPage(1);
          }}
        />
        <div className="w-full sm:w-64">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Name, phone or RDR-000123"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        {rows.isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : list.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {status === "pending" ? "Nobody is waiting." : "Nothing here."}
          </p>
        ) : (
          <table className="w-full min-w-[46rem] text-left text-theme-sm">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-5 py-3 font-medium">Rider</th>
                <th className="px-5 py-3 font-medium">Contact</th>
                <th className="px-5 py-3 font-medium">Vehicle</th>
                <th className="px-5 py-3 font-medium">Documents</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {list.map((r) => (
                <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800 dark:text-white/90">{r.name ?? "—"}</div>
                    <div className="text-theme-xs text-gray-400">{r.rider_code}</div>
                  </td>
                  <td className="px-5 py-3">
                    <div>{r.phone ?? "—"}</div>
                    <div className="text-theme-xs text-gray-400">{r.city ?? "No city"}</div>
                  </td>
                  <td className="px-5 py-3 capitalize">
                    {r.vehicle_type}
                    {r.vehicle_registration ? (
                      <span className="ml-1 text-theme-xs text-gray-400">{r.vehicle_registration}</span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3">
                    {/*
                      The count that decides whether this row can be acted on
                      at all. An application missing a photograph cannot be
                      approved — the server refuses it — so saying so here
                      saves opening it to find out.
                    */}
                    {r.missing_documents.length > 0 ? (
                      <span className="text-warning-600 dark:text-warning-400">
                        {r.missing_documents.length} missing
                      </span>
                    ) : (
                      `${r.documents.length} uploaded`
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge color={TONE[r.status]}>{r.status_label}</Badge>
                      {r.is_platform && <Badge color="light">Any shop</Badge>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button className={ROW_ACTION} onClick={() => setOpen(r.id)}>
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pagination && <Pager pagination={pagination} onPage={setPage} noun="riders" />}
      </div>

      {/* ── One applicant ──────────────────────────────────────────── */}
      <Modal isOpen={open !== null} onClose={() => setOpen(null)} className="max-w-2xl">
        <ModalForm
          title={person?.name ?? "Rider application"}
          description={person ? `${person.rider_code} · ${person.status_label}` : undefined}
          footer={
            person == null ? null : (
              <>
                <Button variant="outline" onClick={() => setOpen(null)}>
                  Close
                </Button>
                {person.status === "approved" ? (
                  <Button
                    variant="outline"
                    disabled={review.isPending || !note.trim()}
                    onClick={() => review.mutate({ id: person.id, verdict: "suspend", why: note.trim() })}
                  >
                    Suspend
                  </Button>
                ) : person.status === "suspended" ? (
                  <Button
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: person.id, verdict: "reinstate", why: note.trim() || undefined })}
                  >
                    Reinstate
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      disabled={review.isPending || !note.trim()}
                      onClick={() => review.mutate({ id: person.id, verdict: "reject", why: note.trim() })}
                    >
                      Reject
                    </Button>
                    <Button
                      disabled={
                        review.isPending ||
                        person.status !== "pending" ||
                        person.missing_documents.length > 0
                      }
                      onClick={() => review.mutate({ id: person.id, verdict: "approve" })}
                    >
                      Approve
                    </Button>
                  </>
                )}
              </>
            )
          }
        >
          {detail.isLoading || person == null ? (
            <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 text-theme-sm">
                <Field label="Phone" value={person.phone} />
                <Field label="Email" value={person.email} />
                {/*
                  The number itself, and only here — a single applicant somebody
                  has deliberately opened. The list shows the last four.
                */}
                <Field label="CNIC" value={person.cnic} />
                <Field label="City" value={person.city} />
                <Field label="Vehicle" value={`${person.vehicle_type}${person.vehicle_registration ? ` · ${person.vehicle_registration}` : ""}`} />
                <Field
                  label="Works for"
                  value={person.is_platform ? "Any shop in the pool" : "Only shops that add them"}
                />
              </dl>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white/90">Documents</h4>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {person.documents.length === 0 && (
                    <p className="px-4 py-6 text-center text-theme-sm text-gray-400">
                      Nothing uploaded yet.
                    </p>
                  )}
                  {person.documents.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                          {d.label}
                        </div>
                        {d.review_note && (
                          <div className="text-theme-xs text-error-500">{d.review_note}</div>
                        )}
                      </div>
                      <Badge
                        color={
                          d.status === "approved" ? "success" : d.status === "rejected" ? "error" : "light"
                        }
                      >
                        {d.status}
                      </Badge>
                      <button className={ROW_ACTION} onClick={() => viewDoc(person.id, d.id)}>
                        View
                      </button>
                      {/*
                        Marked per document, because "your application was
                        rejected" tells somebody nothing about WHICH photograph
                        to take again.
                      */}
                      <button
                        className={ROW_ACTION}
                        disabled={reviewDoc.isPending}
                        onClick={() =>
                          reviewDoc.mutate({
                            id: person.id,
                            docId: d.id,
                            s: d.status === "approved" ? "pending" : "approved",
                          })
                        }
                      >
                        {d.status === "approved" ? "Unmark" : "Looks right"}
                      </button>
                      <button
                        className={ROW_ACTION}
                        disabled={reviewDoc.isPending || !note.trim()}
                        onClick={() =>
                          reviewDoc.mutate({ id: person.id, docId: d.id, s: "rejected", why: note.trim() })
                        }
                      >
                        Reject this
                      </button>
                    </div>
                  ))}
                </div>
                {person.missing_documents.length > 0 && (
                  <p className="mt-2 text-theme-xs text-warning-600 dark:text-warning-400">
                    Still missing: {person.missing_documents.join(", ")}. This cannot be approved yet.
                  </p>
                )}
              </div>

              <div>
                <Label>Reason (shown to the rider)</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. The back of the CNIC is out of focus."
                />
                <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                  Required to reject, to suspend, or to turn down one document. An approval needs
                  no reason.
                </p>
              </div>
            </>
          )}
        </ModalForm>
      </Modal>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-gray-800 dark:text-white/90">{value ?? "—"}</dd>
    </div>
  );
}
