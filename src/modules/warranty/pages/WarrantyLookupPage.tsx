import { useState, type FormEvent } from "react";
import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import TextArea from "../../../components/form/input/TextArea";
import Badge from "../../../components/ui/badge/Badge";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import Pager from "../../../components/ui/pager";
import {
  RESOLUTIONS,
  warrantyService,
  type WarrantyClaim,
  type WarrantyRecord,
} from "../services/warrantyService";
import { ApiError } from "../../../common/types/api";
import { daysLeft, deskDate } from "../cover";

const fmtDate = deskDate;

const daysHeld = (from: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 86_400_000));

/** A sale's status in words — the desk printed `partially_refunded` to a customer's face. */
const SALE_STATUS: Record<string, string> = {
  completed: "Completed",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

const RESOLUTION_LABEL: Record<string, string> = Object.fromEntries(
  RESOLUTIONS.map((r) => [r.value, r.label]),
);

const TABS = [
  { key: "lookup", label: "Look up" },
  { key: "holding", label: "What we're holding" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/**
 * The warranty desk.
 *
 * It could already answer "is this still covered?" — and then had nowhere to
 * put the answer. A customer walks in with a battery, the counter confirms four
 * months left, hands it to the workshop, and the shop's entire record of the
 * transaction is what one person remembers. The second visit starts from
 * nothing, a repeat failure looks like a first one, and nobody can tell the
 * supplier how many of their units came back.
 *
 * Two screens, because a counter asks two different questions: "what is this
 * unit?" when somebody hands one over, and "what are we still holding?" when
 * somebody comes back asking for theirs.
 *
 * ── Which of the two it opens on ────────────────────────────────────────
 *
 * Holding, and it used to be Lookup. A shop with seven units on the bench
 * opened the warranty desk and was shown an empty search box: the only thing
 * on screen was a question, and the seven customers' goods it was responsible
 * for appeared nowhere until somebody found the second tab.
 *
 * Lookup is an ACTION — it needs a serial in somebody's hand, and it is one
 * click away. Holding is a STATE, and a screen should open on what is true
 * rather than on a blank field. The same reason the bay board does not open
 * on a search.
 */
export default function WarrantyLookupPage() {
  const [tab, setTab] = useState<Tab>("holding");

  return (
    <>
      <PageMeta title="Warranty desk" description="Look up a serial and book units in" />
      <div className="mx-auto max-w-3xl">
        <div className="mb-5">
          <h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Warranty desk</h1>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            Look a serial up, take the unit in, and record what happened to it.
          </p>
        </div>

        <FilterTabs tabs={TABS} value={tab} onChange={setTab} className="mb-5" />

        {tab === "lookup" ? <LookupTab /> : <HoldingTab />}
      </div>
    </>
  );
}

// ── Look up a serial, and take it in ─────────────────────────────────

function LookupTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [serial, setSerial] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [record, setRecord] = useState<WarrantyRecord | null>(null);

  const bookModal = useModal();
  const [fault, setFault] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [bookError, setBookError] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: (s: string) => warrantyService.lookup(s),
    onSuccess: ({ data }) => {
      setRecord(data);
      setNotFound(false);
    },
    onError: (e) => {
      setRecord(null);
      // A clean "no such serial" is the common case — everything else surfaces
      // the server message.
      setNotFound(e instanceof ApiError && e.errorCode === "SERIAL_NOT_FOUND");
    },
  });

  const book = useMutation({
    mutationFn: () =>
      warrantyService.book({
        serial: serial.trim(),
        fault: fault.trim(),
        customer_name: name.trim() || undefined,
        customer_phone: phone.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Booked in — the unit is on the holding list");
      bookModal.closeModal();
      setFault(""); setName(""); setPhone("");
      qc.invalidateQueries({ queryKey: ["warranty"] });
      if (serial.trim()) lookup.mutate(serial.trim());
    },
    onError: (e) => setBookError(e instanceof ApiError ? e.message : "Could not book it in"),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = serial.trim();
    if (s) lookup.mutate(s);
  };

  const openBook = () => {
    setBookError(null);
    setFault("");
    setName(record?.sale?.customer_name ?? "");
    setPhone(record?.sale?.customer_phone ?? "");
    bookModal.openModal();
  };

  const openClaim = record?.claims?.find((c) => c.resolution === null);

  return (
    <>
      <form onSubmit={submit} className="flex items-end gap-2">
        <div className="flex-1">
          <Label>Serial / IMEI</Label>
          <Input
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            placeholder="Scan or type the serial / IMEI"
          />
        </div>
        <Button type="submit" disabled={lookup.isPending || !serial.trim()}>
          {lookup.isPending ? "Looking up…" : "Look up"}
        </Button>
      </form>

      {/* A serial the shop never sold is still a unit somebody is standing
          there holding — a receipt from another branch, or one that predates
          the system. Refusing to record it just means the shop keeps their
          property with no record at all. */}
      {notFound && (
        <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 p-6 text-center dark:border-gray-800 dark:bg-white/5">
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            No sale found for that serial / IMEI.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={openBook}>
            Take it in anyway
          </Button>
        </div>
      )}

      {record && (
        <div className="mt-6 space-y-5">
          <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800">
            {/* Warranty banner — the counter's at-a-glance answer.

                THREE answers, and it used to give two. A phone brought back
                and refunded read "Under warranty — 365 days left" with the
                name of a customer who no longer had it: the shop's own stock,
                covered against the shop. A unit that came back is said to
                have come back, in its own colour, before any dates. */}
            {record.came_back ? (
              <div data-testid="warranty-banner" data-state="came-back" className="flex items-center justify-between bg-warning-50 px-6 py-4 dark:bg-warning-500/10">
                <div>
                  <div className="text-lg font-semibold text-warning-700 dark:text-warning-400">
                    {record.came_back.as === "cancelled" ? "That sale was cancelled" : "This unit came back"}
                  </div>
                  <div className="text-theme-sm text-gray-600 dark:text-gray-400">
                    {record.came_back.as === "cancelled" ? "Cancelled" : "Returned and refunded"}
                    {record.came_back.at ? ` ${fmtDate(record.came_back.at)}` : ""}
                    {record.on_shelf ? " — it is on the shelf again." : " — it is not out with a customer."}
                    {" "}There is no warranty to claim under.
                  </div>
                </div>
                <span className="rounded-lg bg-white/70 px-2.5 py-1 font-mono text-theme-sm text-gray-700 dark:bg-black/20 dark:text-gray-200">
                  {record.serial}
                </span>
              </div>
            ) : (
              <div
                data-testid="warranty-banner"
                data-state={record.under_warranty ? "covered" : "expired"}
                className={`flex items-center justify-between px-6 py-4 ${
                  record.under_warranty
                    ? "bg-success-50 dark:bg-success-500/10"
                    : "bg-error-50 dark:bg-error-500/10"
                }`}
              >
                <div>
                  <div className={`text-lg font-semibold ${record.under_warranty ? "text-success-700 dark:text-success-400" : "text-error-700 dark:text-error-400"}`}>
                    {record.under_warranty ? "Under warranty" : "Warranty expired"}
                  </div>
                  <div className="text-theme-sm text-gray-500 dark:text-gray-400">
                    {record.under_warranty
                      ? daysLeft(record.days_left)
                      : record.warranty_expires_at
                        ? `Expired ${fmtDate(record.warranty_expires_at)}`
                        : "No warranty on this item"}
                  </div>
                </div>
                <span className="rounded-lg bg-white/70 px-2.5 py-1 font-mono text-theme-sm text-gray-700 dark:bg-black/20 dark:text-gray-200">
                  {record.serial}
                </span>
              </div>
            )}

            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-6 sm:grid-cols-2">
              <Field label="Product" value={record.product_name} />
              <Field label="Sold on" value={fmtDate(record.sold_at)} />
              <Field label="Warranty" value={record.warranty_months != null ? `${record.warranty_months} months` : "—"} />
              <Field label="Expires" value={fmtDate(record.warranty_expires_at)} />
              <Field label="Invoice" value={record.sale?.invoice_number ?? "—"} />
              <Field label="Sale status" value={record.sale?.status ? SALE_STATUS[record.sale.status] ?? record.sale.status : "—"} />
              {/* Somebody who was given their money back is not this unit's customer. */}
              <Field label={record.came_back ? "Was sold to" : "Customer"} value={record.sale?.customer_name || record.sale?.customer_phone || "Walk-in"} />
            </dl>

            <div className="border-t border-gray-100 px-6 py-4 dark:border-gray-800">
              {openClaim ? (
                <p className="text-theme-sm text-warning-600 dark:text-warning-400">
                  This unit is already with the shop — booked in {daysHeld(openClaim.created_at)} day
                  {daysHeld(openClaim.created_at) === 1 ? "" : "s"} ago for "{openClaim.fault}".
                </p>
              ) : (
                <Button size="sm" onClick={openBook}>Take this unit in</Button>
              )}
            </div>
          </div>

          {/* Has it been back before? The single most useful thing a counter
              can know, and "didn't we replace this already?" is not a filing
              system. */}
          {record.claims && record.claims.length > 0 && (
            <div>
              <h3 className="mb-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                This unit has been back {record.claims.length} time{record.claims.length === 1 ? "" : "s"}
              </h3>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                {record.claims.map((c) => <ClaimRow key={c.id} claim={c} />)}
              </ul>
            </div>
          )}
        </div>
      )}

      <Modal isOpen={bookModal.isOpen} onClose={bookModal.closeModal} className="max-w-md">
        <ModalForm
          title="Take the unit in"
          footer={
            <>
              <Button size="sm" variant="outline" onClick={bookModal.closeModal}>Cancel</Button>
              <Button size="sm" disabled={!fault.trim() || book.isPending} onClick={() => book.mutate()}>
                {book.isPending ? "Booking in…" : "Book it in"}
              </Button>
            </>
          }
        >
          <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
            No money and no stock moves — this records that the shop is holding it.
            Whether it's in warranty is fixed at today's date, so a slow supplier
            can't turn a fair decision into a wrong one.
          </p>
          <div className="space-y-4">
            <div>
              <Label>What's wrong with it <span className="text-error-500">*</span></Label>
              <TextArea
                value={fault}
                onChange={(v) => setFault(v)}
                rows={2}
                placeholder="In the customer's words — e.g. not holding charge overnight"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Customer</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx…" />
              </div>
            </div>
            {bookError && <p className="text-theme-xs text-error-500">{bookError}</p>}
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}

// ── What the shop is holding ─────────────────────────────────────────

function HoldingTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const claims = useQuery({
    queryKey: ["warranty", "claims", status, search, page],
    queryFn: () => warrantyService.claims({ status, search: search || undefined, page }),
  });

  const [closing, setClosing] = useState<WarrantyClaim | null>(null);
  const [resolution, setResolution] = useState("repaired");
  const [note, setNote] = useState("");

  const resolve = useMutation({
    mutationFn: () => warrantyService.resolve(closing!.id, { resolution, note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success("Claim closed");
      setClosing(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["warranty"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not close it"),
  });

  const rows = claims.data?.data ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Serial, phone, name or item…"
          />
        </div>
        <div className="flex gap-1">
          {(["open", "resolved", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setStatus(s); setPage(1); }}
              className={`rounded-lg border px-3 py-2 text-theme-xs font-medium capitalize transition-colors ${
                status === s
                  ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                  : "border-gray-300 text-gray-600 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {claims.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 px-6 py-12 text-center text-theme-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {status === "open"
            ? "Nothing booked in — the shop isn't holding anybody's unit."
            : "No claims match."}
        </p>
      ) : (
        /* `data-rows` says "these are this screen's records".
           Not decoration: the volume suite asks every screen whether it is
           showing anything at a real shop's size, and it could only count
           TABLE rows — so the warranty desk, on a shop holding seven units,
           reported as empty. That was a finding about the probe, stated as a
           finding about the product. A screen declares its own rows rather
           than being guessed at by a selector, because `ul li` would have
           counted the navigation menu. */
        <ul data-rows className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {rows.map((c) => (
            <ClaimRow
              key={c.id}
              claim={c}
              onClose={() => { setClosing(c); setResolution("repaired"); setNote(""); }}
            />
          ))}
        </ul>
      )}

      <Pager pagination={claims.data?.meta?.pagination} onPage={setPage} noun="claims" />

      <Modal isOpen={closing !== null} onClose={() => setClosing(null)} className="max-w-md">
        <ModalForm
          title={`Close ${closing?.product_name ?? "claim"}`}
          footer={
            <>
              <Button size="sm" variant="outline" onClick={() => setClosing(null)}>Cancel</Button>
              <Button size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate()}>
                {resolve.isPending ? "Saving…" : "Close claim"}
              </Button>
            </>
          }
        >
          <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
            Recorded once and not editable afterwards — this is the sentence somebody
            may need to prove later.
          </p>
          <div className="space-y-4">
            <div>
              <Label>What happened</Label>
              <Select
                options={RESOLUTIONS.map((r) => ({ value: r.value, label: r.label }))}
                value={resolution}
                onChange={setResolution}
              />
            </div>
            <div>
              <Label>Note</Label>
              <TextArea
                value={note}
                onChange={(v) => setNote(v)}
                rows={2}
                placeholder="e.g. Swapped under Osaka warranty — old unit returned to supplier"
              />
            </div>
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}

function ClaimRow({ claim, onClose }: { claim: WarrantyClaim; onClose?: () => void }) {
  const open = claim.resolution === null;
  const held = daysHeld(claim.created_at);

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
            {claim.product_name}
          </span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {claim.serial}
          </span>
          {claim.was_under_warranty ? (
            <Badge size="sm" color="success">In warranty</Badge>
          ) : (
            <Badge size="sm" color="light">Out of warranty</Badge>
          )}
          {!open && <Badge size="sm" color="info">{RESOLUTION_LABEL[claim.resolution!] ?? claim.resolution}</Badge>}
        </div>
        <p className="mt-0.5 truncate text-theme-xs text-gray-500 dark:text-gray-400">{claim.fault}</p>
        <p className="mt-0.5 text-theme-xs text-gray-400">
          {claim.customer_name || claim.customer_phone || "Walk-in"}
          {open
            // A unit that has been here three weeks is the one somebody is
            // waiting on, so the count of days is the headline, not the date.
            ? ` · with us ${held} day${held === 1 ? "" : "s"}`
            : ` · closed ${fmtDate(claim.resolved_at)}${claim.resolver ? ` by ${claim.resolver.name}` : ""}`}
          {claim.resolution_note ? ` · ${claim.resolution_note}` : ""}
        </p>
      </div>

      {open && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-theme-xs font-medium text-gray-700 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-gray-700 dark:text-gray-200"
        >
          Close claim
        </button>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-theme-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-theme-sm font-medium text-gray-800 dark:text-white/90">{value}</dd>
    </div>
  );
}
