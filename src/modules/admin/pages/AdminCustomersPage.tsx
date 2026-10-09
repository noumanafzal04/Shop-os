import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiDelete, apiGet, apiPatch, apiPost } from "../../../common/api/client";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Button from "../../../components/ui/button/Button";
import { useConfirm } from "../../../components/ui/confirm";
import { FilterBar, FilterSelect, type AppliedFilter } from "../../../components/ui/filters";
import { Modal, ModalForm } from "../../../components/ui/modal";
import Pager from "../../../components/ui/pager";
import { ROW_ACTION } from "../../../components/ui/table/rowAction";
import { useToast } from "../../../components/ui/toast";
import { CheckCircleIcon, LockIcon, PaperPlaneIcon, PlusIcon, ShootingStarIcon, UserIcon } from "../../../icons";
import { Card, Empty, PageHeader, Person, Pill, StatRow, StatTile } from "../components/kit";

/**
 * THE PLATFORM'S CUSTOMERS — made here, and then found here.
 *
 * This screen was one form. It made an account, said "can sign in now", and
 * that was the last anybody saw of the person: there was no list. Reported as
 * "customers are created and do not show" — they did not, anywhere.
 *
 * Now it is the list first — who they are, whether they have ever ordered,
 * what they have spent across every shop — with the form a button away, and
 * the three things staff do to an account (correct it, set a password, switch
 * it off) on the person's own card.
 */
interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "suspended";
  created_at: string | null;
  last_login_at: string | null;
  orders_count: number;
  last_order_at: string | null;
  spent: number;
}

interface CustomerDetail extends CustomerRow {
  recent_orders: Array<{ id: string; order_number: string; shop: string; status: string; total: number; placed_at: string }>;
  addresses: Array<{ id: string; label: string | null; address: string; is_default: boolean }>;
}

interface Summary {
  total: number;
  active: number;
  suspended: number;
  new_this_month: number;
  have_ordered: number;
}

const STATUS = [
  { value: "active", label: "Can sign in" },
  { value: "suspended", label: "Switched off" },
];
const ORDERED = [
  { value: "yes", label: "Has ordered" },
  { value: "never", label: "Never ordered" },
];
const SORT = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "By name" },
  { value: "orders", label: "Most orders" },
  { value: "spent", label: "Spent the most" },
];

const rupees = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

/** A stored instant, or the database's own "2026-10-09 14:03:11" — read as UTC either way. */
function day(at: string | null): string {
  if (!at) return "—";
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(at) ? at : `${at.replace(" ", "T")}Z`);

  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const said = (e: unknown, otherwise: string) => (e instanceof ApiError ? (e.firstFieldError() ?? e.message) : otherwise);

export default function AdminCustomersPage() {
  const toast = useToast();
  const client = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [ordered, setOrdered] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const typed = useDebouncedValue(search.trim(), 300);

  const narrow = (set: (v: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  const list = useQuery({
    queryKey: ["admin", "customers", "list", { typed, status, ordered, sort, page }],
    queryFn: () =>
      apiGet<CustomerRow[]>("/admin/customers", {
        params: { search: typed || undefined, status: status || undefined, ordered: ordered || undefined, sort, page, per_page: 15 },
      }),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: ["admin", "customers", "summary"],
    queryFn: async () => (await apiGet<Summary>("/admin/customers/summary")).data,
  });

  const rows = list.data?.data ?? [];
  const pagination = list.data?.meta?.pagination;
  const figures = summary.data;
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "customers"] });

  const applied: AppliedFilter[] = [
    status && { key: "status", label: "", value: STATUS.find((s) => s.value === status)?.label ?? status, onRemove: () => narrow(setStatus)("") },
    ordered && { key: "ordered", label: "", value: ORDERED.find((s) => s.value === ordered)?.label ?? ordered, onRemove: () => narrow(setOrdered)("") },
  ].filter(Boolean) as AppliedFilter[];
  const filtered = applied.length > 0 || typed !== "";

  return (
    <>
      <PageMeta title="Customers" area="Admin" description="The people who order from the shops" />

      <PageHeader
        icon={<UserIcon />}
        tone="sky"
        title="Customers"
        subtitle="Everybody with an account on the app — and the ones you made for somebody on the phone."
        actions={
          <Button size="sm" onClick={() => setCreating(true)} startIcon={<PlusIcon className="size-4" />}>
            New customer
          </Button>
        }
      />

      <StatRow>
        <StatTile label="Customers" value={figures?.total.toLocaleString() ?? "—"} tone="sky" icon={<UserIcon />} loading={summary.isLoading} />
        <StatTile
          label="Have ordered"
          value={figures?.have_ordered.toLocaleString() ?? "—"}
          hint={figures && figures.total > 0 ? `${Math.round((figures.have_ordered / figures.total) * 100)}% of everybody` : undefined}
          tone="green"
          icon={<PaperPlaneIcon />}
          loading={summary.isLoading}
          onPress={() => narrow(setOrdered)(ordered === "yes" ? "" : "yes")}
          pressed={ordered === "yes"}
        />
        <StatTile label="New this month" value={figures?.new_this_month.toLocaleString() ?? "—"} tone="purple" icon={<ShootingStarIcon />} loading={summary.isLoading} />
        <StatTile label="Can sign in" value={figures?.active.toLocaleString() ?? "—"} tone="brand" icon={<CheckCircleIcon />} loading={summary.isLoading} />
        <StatTile
          label="Switched off"
          value={figures?.suspended.toLocaleString() ?? "—"}
          tone={figures && figures.suspended > 0 ? "red" : "slate"}
          icon={<LockIcon />}
          loading={summary.isLoading}
          onPress={() => narrow(setStatus)(status === "suspended" ? "" : "suspended")}
          pressed={status === "suspended"}
        />
      </StatRow>

      <FilterBar
        search={{ value: search, onChange: narrow(setSearch), placeholder: "Search name, phone, email…", label: "Search customers" }}
        applied={applied}
        onClearAll={() => {
          setSearch("");
          setStatus("");
          setOrdered("");
          setPage(1);
        }}
        results={{ count: pagination?.total, noun: "customers", loading: list.isLoading }}
      >
        <FilterSelect label="Any status" value={status} onChange={narrow(setStatus)} options={STATUS} />
        <FilterSelect label="Ordered or not" value={ordered} onChange={narrow(setOrdered)} options={ORDERED} />
        <FilterSelect label="Newest first" value={sort === "newest" ? "" : sort} onChange={(v) => narrow(setSort)(v || "newest")} options={SORT.slice(1)} />
      </FilterBar>

      <Card>
        {list.isError ? (
          <Empty icon={<UserIcon />} title="The list could not be loaded" hint={said(list.error, "Try again in a moment.")} action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Try again</Button>} />
        ) : !list.isLoading && rows.length === 0 ? (
          filtered ? (
            <Empty icon={<UserIcon />} title="Nobody matches" hint="Try fewer words, or clear the filters." />
          ) : (
            <Empty
              icon={<UserIcon />}
              title="No customers yet"
              hint="People appear here when they sign up on the app — or make an account for somebody yourself."
              action={<Button size="sm" onClick={() => setCreating(true)}>New customer</Button>}
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left" data-testid="customers-table">
              <thead>
                <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Orders</th>
                  <th className="px-5 py-3 font-medium">Spent</th>
                  <th className="px-5 py-3 font-medium">Last order</th>
                  <th className="px-5 py-3 font-medium">Joined</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {list.isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={7} className="px-5 py-4">
                          <div className="h-9 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                        </td>
                      </tr>
                    ))
                  : rows.map((c) => (
                      <tr key={c.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                        <td className="max-w-[18rem] px-5 py-3">
                          <Person name={c.name} sub={[c.phone, c.email].filter(Boolean).join(" · ") || "No contact kept"} />
                        </td>
                        <td className="px-5 py-3 tabular-nums">
                          {c.orders_count > 0 ? c.orders_count.toLocaleString() : <span className="text-gray-400">None yet</span>}
                        </td>
                        <td className="px-5 py-3 tabular-nums">{c.spent > 0 ? rupees(c.spent) : <span className="text-gray-400">—</span>}</td>
                        <td className="whitespace-nowrap px-5 py-3">{day(c.last_order_at)}</td>
                        <td className="whitespace-nowrap px-5 py-3">{day(c.created_at)}</td>
                        <td className="px-5 py-3">
                          {c.status === "active" ? <Pill tone="green">Can sign in</Pill> : <Pill tone="red">Switched off</Pill>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button type="button" className={ROW_ACTION} onClick={() => setOpenId(c.id)} aria-label={`Open ${c.name}`}>
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Pager pagination={pagination} onPage={setPage} noun="customers" />

      {creating && (
        <NewCustomer
          onClose={() => setCreating(false)}
          onMade={(name) => {
            toast.success(`${name} can sign in now — give them the number and password you typed.`);
            // The person just made is the newest: show the list they are on top of.
            setSearch("");
            setStatus("");
            setOrdered("");
            setSort("newest");
            setPage(1);
            setCreating(false);
            void refresh();
          }}
        />
      )}

      {openId && <CustomerCard id={openId} onClose={() => setOpenId(null)} onChanged={() => void refresh()} />}
    </>
  );
}

function NewCustomer({ onClose, onMade }: { onClose: () => void; onMade: (name: string) => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const put = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      apiPost<CustomerRow>("/admin/customers", {
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        password: form.password,
      }),
    onSuccess: ({ data }) => onMade(data.name),
  });

  const ready = form.name.trim() !== "" && (form.phone.trim() !== "" || form.email.trim() !== "") && form.password.length >= 8;
  const refused = create.error instanceof ApiError ? create.error : null;
  const errorOf = (field: string) => refused?.errors[field]?.[0];

  return (
    <Modal isOpen onClose={onClose} className="max-w-lg">
      <ModalForm
        title="New customer"
        description="For somebody who cannot make their own account — a caller placing an order, a regular who does not use apps."
        footer={
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create account"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {refused && Object.keys(refused.errors).length === 0 && (
            <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">{refused.message}</p>
          )}
          <div>
            <Label htmlFor="cust-name">Name</Label>
            <Input id="cust-name" value={form.name} onChange={put("name")} placeholder="Farhan Ali" />
            {errorOf("name") && <p className="mt-1 text-theme-xs text-error-500">{errorOf("name")}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="cust-phone">Phone</Label>
              <Input id="cust-phone" value={form.phone} onChange={put("phone")} placeholder="03001234567" />
              {errorOf("phone") && <p className="mt-1 text-theme-xs text-error-500">{errorOf("phone")}</p>}
            </div>
            <div>
              <Label htmlFor="cust-email">Email</Label>
              <Input id="cust-email" type="email" value={form.email} onChange={put("email")} placeholder="farhan@example.com" />
              {errorOf("email") && <p className="mt-1 text-theme-xs text-error-500">{errorOf("email")}</p>}
            </div>
          </div>
          <p className="-mt-2 text-theme-xs text-gray-400">A phone or an email — they sign in with either, so one of the two is needed.</p>
          <div>
            <Label htmlFor="cust-password">Password</Label>
            <Input id="cust-password" type="password" value={form.password} onChange={put("password")} placeholder="At least 8 characters" />
            {errorOf("password") && <p className="mt-1 text-theme-xs text-error-500">{errorOf("password")}</p>}
          </div>
        </div>
      </ModalForm>
    </Modal>
  );
}

/** One person: what the platform knows about them, and what staff can do. */
function CustomerCard({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [password, setPassword] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["admin", "customers", "one", id],
    queryFn: async () => (await apiGet<CustomerDetail>(`/admin/customers/${id}`)).data,
  });
  const c = detail.data;

  const after = (message?: string) => {
    if (message) toast.success(message);
    void client.invalidateQueries({ queryKey: ["admin", "customers", "one", id] });
    onChanged();
  };

  const save = useMutation({
    mutationFn: () =>
      apiPatch<CustomerRow>(`/admin/customers/${id}`, {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      }),
    onSuccess: ({ message }) => {
      setEditing(false);
      after(message ?? "Saved");
    },
    onError: (e) => toast.error(said(e, "That did not save.")),
  });
  const turn = useMutation({
    mutationFn: (to: "suspend" | "activate") => apiPost<CustomerRow>(`/admin/customers/${id}/${to}`),
    onSuccess: ({ message }) => after(message),
    onError: (e) => toast.error(said(e, "That did not go through.")),
  });
  const reset = useMutation({
    mutationFn: () => apiPost<CustomerRow>(`/admin/customers/${id}/password`, { password }),
    onSuccess: ({ message }) => {
      setPassword(null);
      after(message);
    },
    onError: (e) => toast.error(said(e, "The password was not set.")),
  });

  const remove = useMutation({
    mutationFn: () => apiDelete<null>(`/admin/customers/${id}`),
    onSuccess: ({ message }) => {
      toast.success(message ?? "Account removed");
      onChanged();
      onClose();
    },
    onError: (e) => toast.error(said(e, "The account was not removed.")),
  });

  const takeAway = async () => {
    if (!c) return;
    if (
      await confirm({
        title: `Remove ${c.name}'s account?`,
        message: "For an account made by mistake. It is gone for good, and the phone and email can be used for a new one.",
        confirmLabel: "Remove account",
        tone: "danger",
      })
    ) {
      remove.mutate();
    }
  };

  const switchOff = async () => {
    if (!c) return;
    if (
      await confirm({
        title: `Switch off ${c.name}'s account?`,
        message: "They are signed out everywhere and cannot sign in until it is switched back on. Their orders are kept.",
        confirmLabel: "Switch off",
        tone: "danger",
      })
    ) {
      turn.mutate("suspend");
    }
  };

  return (
    <Modal isOpen onClose={onClose} className="max-w-2xl">
      <ModalForm
        title={c?.name ?? "Customer"}
        description={c ? `Joined ${day(c.created_at)}${c.last_login_at ? ` · last signed in ${day(c.last_login_at)}` : " · has never signed in"}` : undefined}
        footer={
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
            {c && !editing && password === null && (
              <>
                <Button size="sm" variant="outline" onClick={() => { setForm({ name: c.name, phone: c.phone ?? "", email: c.email ?? "" }); setEditing(true); }}>
                  Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPassword("")}>Set a password</Button>
                {/* Not `danger`: it can be switched straight back on. Red is for
                    what cannot be undone, which on this card is Remove. */}
                {c.status === "active" ? (
                  <Button size="sm" variant="outline" disabled={turn.isPending} onClick={() => void switchOff()}>Switch off</Button>
                ) : (
                  <Button size="sm" disabled={turn.isPending} onClick={() => turn.mutate("activate")}>Switch back on</Button>
                )}
                {/* Only somebody who has never ordered. An order goes with its
                    customer, so anybody else is switched off — and the card
                    says why there is no button rather than hiding the rule. */}
                {c.orders_count === 0 && (
                  <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => void takeAway()}>Remove account</Button>
                )}
              </>
            )}
          </>
        }
      >
        {detail.isLoading || !c ? (
          <div className="space-y-3">
            <div className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            <div className="h-24 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          </div>
        ) : (
          <div className="space-y-5" data-testid="customer-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Person name={c.name} sub={[c.phone, c.email].filter(Boolean).join(" · ") || "No contact kept"} />
              {c.status === "active" ? <Pill tone="green">Can sign in</Pill> : <Pill tone="red">Switched off</Pill>}
            </div>

            {editing && (
              <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="edit-name">Name</Label>
                    <Input id="edit-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label htmlFor="edit-phone">Phone</Label>
                    <Input id="edit-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                  </div>
                  <div>
                    <Label htmlFor="edit-email">Email</Label>
                    <Input id="edit-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" disabled={save.isPending || form.name.trim() === ""} onClick={() => save.mutate()}>
                    {save.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {password !== null && (
              <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
                <p className="mt-1.5 text-theme-xs text-gray-400">They are signed out everywhere, and sign back in with this.</p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" disabled={reset.isPending || password.length < 8} onClick={() => reset.mutate()}>
                    {reset.isPending ? "Setting…" : "Set password"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPassword(null)}>Cancel</Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <StatTile label="Orders" value={c.orders_count.toLocaleString()} tone="sky" />
              <StatTile label="Spent" value={rupees(c.spent)} hint="Delivered orders only" tone="green" />
              <StatTile label="Last order" value={<span className="text-lg">{day(c.last_order_at)}</span>} tone="slate" />
            </div>

            <section>
              <h4 className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Latest orders</h4>
              {c.recent_orders.length === 0 ? (
                <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                  They have not ordered from any shop yet — so if this account was made by mistake, it can be removed.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {c.recent_orders.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-theme-sm">
                      <span className="min-w-0">
                        <span className="font-medium text-gray-800 dark:text-white/90">{o.shop}</span>
                        <span className="text-gray-400"> · {o.order_number} · {day(o.placed_at)}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums text-gray-700 dark:text-gray-300">{rupees(o.total)}</span>
                        <Pill tone={o.status === "completed" ? "green" : o.status === "cancelled" ? "red" : "amber"}>{o.status.replace(/_/g, " ")}</Pill>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {c.addresses.length > 0 && (
              <section>
                <h4 className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Addresses</h4>
                <ul className="space-y-1.5 text-theme-sm text-gray-700 dark:text-gray-300">
                  {c.addresses.map((a) => (
                    <li key={a.id}>
                      {a.label && <span className="font-medium text-gray-800 dark:text-white/90">{a.label}: </span>}
                      {a.address}
                      {a.is_default && <span className="text-gray-400"> · default</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </ModalForm>
    </Modal>
  );
}
