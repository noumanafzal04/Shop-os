import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet, apiPatch } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import TextArea from "../../../components/form/input/TextArea";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import { FilterChips } from "../../../components/ui/filters";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import { Waiting } from "../components/Waiting";
import { howLong } from "../components/waitingTime";

/**
 * PEOPLE WHO ASKED FOR A PERSON.
 *
 * The landing page gives most visitors a working shop in one tap, and nothing
 * reaches this screen from them. What reaches it is the two the tap does not
 * suit: somebody who wants walking through it, and somebody with one question
 * in the way of buying. Both are further along than a demo visitor, not less.
 *
 * The screen exists at all because a contact form whose submissions land
 * nowhere is worse than no form — it takes a lead and a promise and drops
 * both. Oldest first, and the age of the oldest is printed at the top, which
 * is the only number that says whether this is being run properly.
 */
type Enquiry = {
  id: string;
  kind: "walkthrough" | "question";
  name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  business_type: string | null;
  city: string | null;
  prefers_at: string | null;
  message: string | null;
  status: "new" | "contacted" | "closed";
  handling_note: string | null;
  handled_at: string | null;
  created_at: string;
  handler?: { id: string; name: string } | null;
};

type Filter = "open" | "walkthrough" | "question" | "all";

/** A wanted time, printed the way somebody would say it out loud. */
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PK", {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit",
  });

const QUEUES = [
  { value: "open" as const, label: "Open" },
  // Two kinds, and they want different halves of a week: a question wants
  // answering today, a walkthrough wants half an hour booked next week.
  { value: "walkthrough" as const, label: "Walkthroughs" },
  { value: "question" as const, label: "Questions" },
  { value: "all" as const, label: "All" },
];

export default function AdminEnquiriesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");
  const [answering, setAnswering] = useState<Enquiry | null>(null);
  const [note, setNote] = useState("");

  const rows = useQuery({
    queryKey: ["admin", "enquiries", filter],
    queryFn: () =>
      apiGet<Enquiry[]>("/admin/enquiries", {
        params:
          filter === "walkthrough" || filter === "question"
            ? { status: "open", kind: filter }
            : { status: filter },
      }),
  });

  const save = useMutation({
    mutationFn: ({ id, status, handling_note }: { id: string; status: Enquiry["status"]; handling_note?: string }) =>
      apiPatch<Enquiry>(`/admin/enquiries/${id}`, { status, handling_note: handling_note || null }),
    onSuccess: ({ message }) => {
      toast.success(message ?? "Saved.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "enquiries"] });
      setAnswering(null);
      setNote("");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof ApiError ? e.message : "That did not go through."),
  });

  const list = rows.data?.data ?? [];
  const oldest = list.find((r) => r.status === "new");
  // Only while "Open" is the tab in force: the other tabs hold answered rows,
  // and a count taken from them would be a different number under one word.
  const unanswered = filter === "open" ? list.length : undefined;

  return (
    <>
      <PageMeta title="Enquiries | CartZe" description="People asking for a walkthrough or with a question" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Enquiries</h1>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            {oldest
              ? <>Somebody has been waiting <strong>{howLong(oldest.created_at)}</strong> for a reply.</>
              : "Nobody is waiting."}
          </p>
        </div>

        <FilterChips
          options={QUEUES}
          value={filter}
          counts={{ open: unanswered }}
          ariaLabel="Which enquiries to show"
          onChange={setFilter}
        />
      </div>

      {rows.isLoading && <p className="text-theme-sm text-gray-500">Loading…</p>}

      {!rows.isLoading && list.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            Nothing here. Most visitors take the demo instead, which needs nobody.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {list.map((r) => (
          <div key={r.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 dark:text-white/90">{r.name}</p>
                <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                  {/* mailto, because replying IS the action this screen is for
                      and there is no message-sending in the product. */}
                  <a href={`mailto:${r.email}`} className="text-brand-500 hover:text-brand-600">{r.email}</a>
                  {r.phone ? <> · <a href={`tel:${r.phone}`} className="text-brand-500 hover:text-brand-600">{r.phone}</a></> : null}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {r.status === "new" ? <Waiting since={r.created_at} /> : null}
                <Badge color={r.kind === "walkthrough" ? "info" : "light"}>
                  {r.kind === "walkthrough" ? "walkthrough" : "question"}
                </Badge>
                <Badge color={r.status === "closed" ? "success" : r.status === "contacted" ? "info" : "warning"}>
                  {r.status}
                </Badge>
              </div>
            </div>

            <p className="text-theme-sm text-gray-600 dark:text-gray-300">
              {r.business_name ?? <span className="text-gray-400">no shop named</span>}
              {r.business_type ? <span className="text-gray-400"> · {r.business_type}</span> : null}
              {r.city ? <span className="text-gray-400"> · {r.city}</span> : null}
            </p>

            {r.prefers_at && (
              // WANTED, not booked. Nothing in this product holds a slot, so
              // the word here has to stay "wants".
              <p className="mt-2 text-theme-sm font-medium text-gray-700 dark:text-gray-200">
                Wants a time around {when(r.prefers_at)}
              </p>
            )}

            {r.message ? (
              <p className="mt-2 text-theme-sm italic text-gray-500 dark:text-gray-400">“{r.message}”</p>
            ) : null}

            {r.handling_note ? (
              <p className="mt-2 text-theme-sm text-gray-500 dark:text-gray-400">
                <span className="font-medium">Note:</span> {r.handling_note}
                {r.handler ? <span className="text-gray-400"> — {r.handler.name}</span> : null}
              </p>
            ) : null}

            {r.status !== "closed" && (
              <div className="mt-4 flex flex-wrap gap-2.5">
                {r.status === "new" && (
                  <Button
                    size="sm"
                    disabled={save.isPending}
                    onClick={() => save.mutate({ id: r.id, status: "contacted" })}
                  >
                    Mark contacted
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => { setAnswering(r); setNote(r.handling_note ?? ""); }}>
                  Close with a note
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal isOpen={answering !== null} onClose={() => setAnswering(null)} className="max-w-md">
        <ModalForm
          title="Close this enquiry"
          description={answering ? `${answering.name} — ${answering.email}` : ""}
          footer={
            <>
              <Button size="sm" variant="outline" onClick={() => setAnswering(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={save.isPending}
                onClick={() => {
                  if (answering) save.mutate({ id: answering.id, status: "closed", handling_note: note });
                }}
              >
                Close it
              </Button>
            </>
          }
        >
          <div>
            <p className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              What happened
            </p>
            <TextArea
              value={note}
              onChange={setNote}
              rows={4}
              placeholder="Walked them through it on Thursday. Coming back after Eid."
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Optional, but it is the only record of this conversation.
            </p>
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}
