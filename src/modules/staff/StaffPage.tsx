import { useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import Button from "../../components/ui/button/Button";
import Badge from "../../components/ui/badge/Badge";
import Input from "../../components/form/input/InputField";
import { FilterBar, FilterSelect, type AppliedFilter } from "../../components/ui/filters";
import Label from "../../components/form/Label";
import Alert from "../../components/ui/alert/Alert";
import { Modal, ModalForm } from "../../components/ui/modal";
import { useToast } from "../../components/ui/toast";
import { useModal } from "../../hooks/useModal";
import { ApiError } from "../../common/types/api";
import { useDebouncedValue } from "../../common/hooks/useDebouncedValue";
import type { User } from "../auth/types";
import { useBranches } from "../branches/hooks/useBranches";
import Select from "../../components/form/Select";
import { useStaffModule, type StaffInput } from "./hooks/useStaff";
import { hintFor, labelFor } from "./permissions";
import { useConfirm } from "../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../components/ui/table/rowAction";
import Pager from "../../components/ui/pager";

interface Props {
  title: string;
  subtitle: string;
  basePath: string; // "/admin/staff" | "/staff"
}

const STAFF_STATUS = [
  { value: "active", label: "Working here" },
  { value: "suspended", label: "Suspended" },
];

export default function StaffPage({ title, subtitle, basePath }: Props) {
  const confirm = useConfirm();
  const staff = useStaffModule(basePath);
  const permissions = staff.usePermissionCatalog();
  const presets = staff.useJobPresets();

  const isTenantSide = basePath === "/staff";

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [job, setJob] = useState("");
  const [page, setPage] = useState(1);
  const list = staff.useStaffList({
    search: useDebouncedValue(search, 350),
    // Only the tenant list can be narrowed this way. The platform staff list
    // shares this component and has no branches, no shop jobs and no shop
    // permissions — sending them would be three parameters the server would
    // rightly ignore, on a screen that had no way to set them.
    status: isTenantSide ? status : "",
    branch_id: isTenantSide ? branchFilter : "",
    job: isTenantSide ? job : "",
    page,
  });

  const modal = useModal();
  const toast = useToast();
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<{
    name: string; email: string; phone: string; password: string;
    permissions: string[]; branch_id: string;
  }>({
    name: "", email: "", phone: "", password: "", permissions: [], branch_id: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * WHICH BRANCH THIS PERSON WORKS AT.
   *
   * The server has accepted and written `branch_id` on staff since branches
   * existed. Nothing ever sent it — the word did not appear on this screen —
   * so every staff member in every multi-branch shop fell back to Main, and
   * branch two's cashier rang on branch one's stock. The whole staff-branch
   * model was driven by a column nothing set.
   *
   * Tenant side only: the platform route REFUSES the field (`prohibited`),
   * because a platform staff member belongs to no shop and so to no branch of
   * one. And only asked when there is a choice — a single-branch shop showing a
   * select with one option in it is a question with one answer.
   */
  const branches = useBranches(isTenantSide);
  const branchList = branches.data ?? [];
  const picksBranch = isTenantSide && branchList.length > 1;
  const branchName = (id: string | null | undefined) =>
    branchList.find((b) => b.id === id)?.name ?? null;

  const mutation = editing ? staff.update : staff.create;
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];
  const generalError = apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const rows = list.data?.data ?? [];
  const pagination = list.data?.meta.pagination;
  const catalog = permissions.data ?? [];

  /**
   * The server's copy wins; the bundled map is the fallback.
   *
   * Keeping the fallback matters for the staff LIST, which renders chips for
   * permissions a person already holds — including any the catalog no longer
   * offers, where the server has nothing to say and a raw slug would otherwise
   * show.
   */
  const described = new Map(catalog.map((p) => [p.key, p]));
  const label = (key: string) => described.get(key)?.label ?? labelFor(key);
  const hint = (key: string) => described.get(key)?.hint ?? hintFor(key);

  /**
   * THE BOXES THIS SHOP CAN ACTUALLY USE.
   *
   * The job presets above have been filtered by the shop's modules and trade
   * since they were written; the checkboxes they tick never were. So a mart
   * hiring a cashier was offered Kitchen board, Serve any table and
   * Reservations — three boxes granting access to screens that shop does not
   * have, on the one screen where a wrongly-ticked box matters.
   */
  const offered = catalog.filter((p) => p.available !== false);

  /**
   * …and the ones somebody already HOLDS that this shop no longer uses.
   *
   * Hidden entirely, they would be submitted away: the form sends the boxes it
   * drew, so a staff member hired while the shop had dine-in would quietly
   * lose `tables.serve_any` the next time anybody corrected their phone
   * number. They are shown apart, greyed, and can only be given up on purpose.
   */
  const heldButUnused = catalog.filter(
    (p) => p.available === false && form.permissions.includes(p.key),
  );

  // "Everything" means every box this shop is OFFERED, not merely a non-empty
  // list — so the warning below cannot fire on a staffer who happens to hold
  // a lot of permissions.
  const allChecked =
    offered.length > 0 && offered.every((p) => form.permissions.includes(p.key));
  const jobs = presets.data ?? [];

  /**
   * Which job the ticked boxes currently describe, if any.
   *
   * Feedback rather than state: nothing stores which preset was used, so this
   * is recomputed from the ticks themselves. Deviate by one box and it reads
   * "Custom", which is the honest answer and tells the owner their edit landed.
   */
  const samePermissions = (a: string[], b: string[]) =>
    a.length === b.length && a.every((p) => b.includes(p));
  const activeJob = jobs.find((j) => samePermissions(j.permissions, form.permissions)) ?? null;

  // "Start from" replaces rather than merges — going from Manager back down to
  // Cashier has to be possible, and merging would make it a one-way door.
  const applyJob = (job: { permissions: string[] }) =>
    setForm((f) => ({ ...f, permissions: [...job.permissions] }));

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", email: "", phone: "", password: "", permissions: [], branch_id: "" });
    staff.create.reset();
    modal.openModal();
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({
      name: u.name, email: u.email ?? "", phone: u.phone ?? "", password: "",
      permissions: u.permissions ?? [], branch_id: u.branch_id ?? "",
    });
    staff.update.reset();
    modal.openModal();
  };

  const togglePerm = (key: string) =>
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));

  const submit = () => {
    if (mutation.isPending) return;
    const base: Partial<StaffInput> = {
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      permissions: form.permissions,
      // Sent only where the field is allowed, and "" means "no pin" — which the
      // server reads as falling back to Main. Sending it on the platform route
      // would be a 422 on a screen that has no branches to offer.
      ...(picksBranch ? { branch_id: form.branch_id || null } : {}),
    };
    if (editing) {
      staff.update.mutate(
        { id: editing.id, ...base, ...(form.password ? { password: form.password } : {}) },
        {
          onSuccess: () => { modal.closeModal(); toast.success(`${base.name} updated`); },
        },
      );
    } else {
      staff.create.mutate({ ...base, password: form.password } as StaffInput, {
        onSuccess: () => { modal.closeModal(); toast.success(`${base.name} added`); },
      });
    }
  };

  /**
   * Suspending had no outcome of any kind — no confirmation, and a failure
   * went nowhere at all, because the only error surface on this screen is
   * inside the form modal and this button is on the row behind it. QA reported
   * it as "nothing happens when you click suspend", which is exactly what a
   * silent request looks like from the outside whether it worked or not.
   */
  const toggleSuspend = (u: User) => {
    const suspending = u.status === "active";
    staff.update.mutate(
      { id: u.id, status: suspending ? "suspended" : "active" },
      {
        onSuccess: () =>
          toast.success(suspending ? `${u.name} suspended — they cannot sign in` : `${u.name} reactivated`),
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.message : `Couldn't ${suspending ? "suspend" : "reactivate"} ${u.name}.`),
      },
    );
  };

  const remove = async (u: User) => {
    if (await confirm({
      title: `Remove ${u.name}?`,
      message: "Their sessions end immediately.",
      confirmLabel: "Remove",
      tone: "danger",
    })) {
      staff.remove.mutate(u.id, {
        onSuccess: () => toast.success(`${u.name} removed`),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : `Couldn't remove ${u.name}.`),
      });
    }
  };

  const applied: AppliedFilter[] = [
    status && {
      key: "status",
      label: "",
      value: STAFF_STATUS.find((s) => s.value === status)?.label ?? status,
      onRemove: () => { setStatus(""); setPage(1); },
    },
    job && {
      key: "job",
      label: "Job",
      value: jobs.find((j) => j.code === job)?.label ?? job,
      onRemove: () => { setJob(""); setPage(1); },
    },
    branchFilter && {
      key: "branch",
      label: "Branch",
      value: branchFilter === "none"
        ? "No branch pinned"
        : (branchList.find((b) => b.id === branchFilter)?.name ?? branchFilter),
      onRemove: () => { setBranchFilter(""); setPage(1); },
    },
  ].filter(Boolean) as AppliedFilter[];

  // One count for the header, the skeletons and the empty state. Three places
  // counting independently is three places that can be wrong, and the symptom
  // is a "nothing here" message sitting under half a table.
  const COLUMNS = 5 + (picksBranch ? 1 : 0) + (isTenantSide ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setJob("");
    setBranchFilter("");
    setPage(1);
  };

  return (
    <>
      <PageMeta title={`${title} | CartZe`} description={subtitle} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">{title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        <Button size="sm" onClick={openCreate}>+ Add Staff</Button>
      </div>

      <FilterBar
        search={{
          value: search,
          onChange: (value) => { setSearch(value); setPage(1); },
          placeholder: "Search name, email, phone…",
          label: "Search staff",
        }}
        applied={applied}
        onClearAll={clearFilters}
        results={{ count: pagination?.total, noun: "people", loading: list.isLoading }}
      >
        {isTenantSide && (
          <>
            {/* The question a staff list is opened with after somebody leaves,
                and the one the server has answered all along while the screen
                had no way to ask it. */}
            <FilterSelect
              label="Everyone"
              value={status}
              onChange={(value) => { setStatus(value); setPage(1); }}
              options={STAFF_STATUS}
            />

            {/* WHAT THEY DO, in the word an owner thinks in. Nobody goes
                looking for "the people holding sales.void". Only the jobs this
                shop is actually offered — the same filtered list the form
                uses, so a mart is never asked to find its waiters. */}
            {jobs.length > 0 && (
              <FilterSelect
                label="Any job"
                value={job}
                onChange={(value) => { setJob(value); setPage(1); }}
                options={jobs.map((j) => ({ value: j.code, label: j.label }))}
              />
            )}

            {picksBranch && (
              <FilterSelect
                label="Any branch"
                value={branchFilter}
                onChange={(value) => { setBranchFilter(value); setPage(1); }}
                options={[
                  // "Pinned to none" is a real answer, not the absence of a
                  // filter — those people ring against Main.
                  { value: "none", label: "No branch pinned" },
                  ...branchList.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
            )}
          </>
        )}
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Contact</th>
                {/* Only where there is more than one branch to be at. Same rule
                    the other branch-scoped lists follow — sales, transfers,
                    registers, the day — so a single-site shop is never shown a
                    column that says "Main" all the way down. */}
                {picksBranch && <th className="px-6 py-3 font-medium">Branch</th>}
                {/* WHAT THEY DO. Derived from the boxes they hold, so it is
                    always true — and "Custom" where somebody was edited away
                    from a template, which tells the owner their edit landed
                    rather than rounding them to the nearest job. */}
                {isTenantSide && <th className="px-6 py-3 font-medium">Job</th>}
                <th className="px-6 py-3 font-medium">Permissions</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {list.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={COLUMNS} className="px-6 py-4"><div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLUMNS} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                  {applied.length > 0 || search
                    ? "Nobody matches these filters."
                    : "No staff yet — add your first team member."}
                </td></tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">{u.name}</td>
                    <td className="px-6 py-4 text-theme-xs">{u.email ?? u.phone ?? "—"}</td>
                    {picksBranch && (
                      <td className="px-6 py-4 text-theme-xs">
                        {/* No pin reads as Main, because that is what the server
                            does with it — not as "—", which would suggest they
                            work nowhere. */}
                        {branchName(u.branch_id) ?? (
                          <span className="text-gray-400">Main</span>
                        )}
                      </td>
                    )}
                    {isTenantSide && (
                      <td className="px-6 py-4">
                        {u.job ? (
                          <span className="rounded-lg bg-brand-50 px-2 py-1 text-theme-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                            {u.job}
                          </span>
                        ) : (
                          <span className="text-theme-xs text-gray-400">Custom</span>
                        )}
                      </td>
                    )}
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {(u.permissions ?? []).slice(0, 3).map((p) => (
                          <span key={p} className="rounded bg-gray-100 px-2 py-0.5 text-theme-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            {label(p)}
                          </span>
                        ))}
                        {(u.permissions ?? []).length > 3 && (
                          <span className="text-theme-xs text-gray-400">+{(u.permissions ?? []).length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge size="sm" color={u.status === "active" ? "success" : "error"}>{u.status}</Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {/* Named per ROW. Down a column of twenty people a screen
                          reader otherwise hears "Edit, Suspend, Remove" twenty
                          times with nothing to say whose. Same treatment the
                          catalogue's rows already got. */}
                      <button className={ROW_ACTION} aria-label={`Edit ${u.name}`} onClick={() => openEdit(u)}>Edit</button>
                      <button
                        className={ROW_ACTION}
                        aria-label={`${u.status === "active" ? "Suspend" : "Activate"} ${u.name}`}
                        onClick={() => toggleSuspend(u)}
                      >
                        {u.status === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button className={ROW_ACTION_DANGER} aria-label={`Remove ${u.name}`} onClick={() => remove(u)}>Remove</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pager pagination={pagination} onPage={setPage} noun="staff" />
      </div>

      {/* Create / edit */}
      {/* Eighteen permissions, ten job pills and five fields do not fit a laptop
          screen, so the form scrolls inside itself: the name of the person and
          the button that saves them both stay put while the middle moves. */}
      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-2xl">
        <ModalForm
          title={editing ? `Edit ${editing.name}` : "Add Staff"}
          footer={
            <>
              <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={mutation.isPending || !form.name.trim() || form.permissions.length === 0 || (!editing && !form.password) || (!editing && !form.email.trim() && !form.phone.trim())}
              >
                {mutation.isPending ? "Saving…" : editing ? "Save changes" : "Add staff"}
              </Button>
            </>
          }
        >
        {generalError && <Alert variant="error" title="Couldn't save" message={generalError} />}

          <div>
            <Label>Name <span className="text-error-500">*</span></Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            {errorFor("name") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("name")}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              {errorFor("email") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("email")}</p>}
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              {errorFor("phone") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("phone")}</p>}
            </div>
          </div>
          <div>
            <Label>{editing ? "New password (optional)" : "Temp password"} {!editing && <span className="text-error-500">*</span>}</Label>
            <Input type="text" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="Min. 8 chars" />
            {errorFor("password") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("password")}</p>}
          </div>

          {picksBranch && (
            <div>
              <Label>Which branch do they work at?</Label>
              <Select
                value={form.branch_id}
                onChange={(v) => set("branch_id", v)}
                placeholder="Main (no branch pinned)"
                options={branchList.map((b) => ({ value: b.id, label: b.name }))}
              />
              {/* Not a preference. A staff member is PINNED to their branch by
                  the server and cannot move with a header, so this decides
                  whose stock they sell and whose drawer they count. */}
              <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                They can only work this branch — its stock, its till, its day. Leave it
                unset and they fall back to Main.
              </p>
              {errorFor("branch_id") && (
                <p className="mt-1 text-theme-xs text-error-500">{errorFor("branch_id")}</p>
              )}
            </div>
          )}

          <div>
            {/* The job comes first. Seventeen checkboxes is the right model and
                a terrible question to open with — an owner knows they are
                hiring a cashier, not that a cashier needs sales.manage but
                must not have sales.void. */}
            {jobs.length > 0 && (
              <div className="mb-4">
                <Label>What do they do?</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {jobs.map((job) => {
                    const active = activeJob?.code === job.code;
                    return (
                      <button
                        key={job.code}
                        type="button"
                        onClick={() => applyJob(job)}
                        aria-pressed={active}
                        title={job.description}
                        className={`rounded-full border px-3 py-1.5 text-theme-sm font-medium transition ${
                          active
                            ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400"
                            : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                        }`}
                      >
                        {job.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">
                  {activeJob
                    ? activeJob.description
                    : form.permissions.length > 0
                      ? "Custom \u2014 these permissions don\u2019t match a standard job."
                      : "Pick a job to fill in the usual permissions, then change anything you like below."}
                </p>
              </div>
            )}

            <div className="flex items-end justify-between gap-3">
              <Label>Permissions <span className="text-error-500">*</span></Label>
              {/* Every box at once. Useful for a partner or a second manager,
                  where ticking nineteen boxes by hand is the only thing
                  standing between the owner and a working account. */}
              <div className="mb-1.5 flex items-center gap-3 text-theme-xs">
                <button
                  type="button"
                  className="font-medium text-brand-500 hover:text-brand-600 disabled:opacity-40 dark:text-brand-400"
                  disabled={allChecked}
                  // Every box THIS SHOP is offered. Handing out a permission
                  // for a module it does not have is not "everything", it is
                  // noise nobody asked for.
                  onClick={() => setForm((f) => ({ ...f, permissions: offered.map((p) => p.key) }))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="font-medium text-gray-500 hover:text-gray-700 disabled:opacity-40 dark:text-gray-400"
                  disabled={form.permissions.length === 0}
                  onClick={() => setForm((f) => ({ ...f, permissions: [] }))}
                >
                  Clear
                </button>
              </div>
            </div>
            {allChecked && (
              <p className="mt-1 text-theme-xs text-warning-600 dark:text-warning-400">
                This person will be able to do everything you can, including
                {isTenantSide ? " shop settings and hiring staff" : " managing platform staff"}.
              </p>
            )}
            <div className="mt-1 grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800 sm:grid-cols-2">
              {offered.map(({ key }) => {
                const explanation = hint(key);
                return (
                  <label key={key} className="flex cursor-pointer items-start gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={form.permissions.includes(key)} onChange={() => togglePerm(key)} />
                    <span>
                      {label(key)}
                      {explanation && <span className="block text-theme-xs text-gray-400">{explanation}</span>}
                    </span>
                  </label>
                );
              })}
            </div>

            {/* Held from a module this shop no longer has. Shown so it can be
                taken away deliberately rather than by a save nobody read. */}
            {heldButUnused.length > 0 && (
              <div className="mt-2 rounded-lg border border-warning-200 bg-warning-25 p-3 dark:border-warning-500/30 dark:bg-warning-500/10">
                <p className="mb-2 text-theme-xs font-medium text-warning-700 dark:text-warning-400">
                  Held from a part of the shop you no longer use
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {heldButUnused.map(({ key }) => (
                    <label key={key} className="flex cursor-pointer items-start gap-2 text-theme-sm text-gray-600 dark:text-gray-400">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked onChange={() => togglePerm(key)} />
                      <span>{label(key)}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-theme-xs text-warning-700/80 dark:text-warning-400/80">
                  Nothing happens while that part is switched off. Untick to take it away for good.
                </p>
              </div>
            )}
            {errorFor("permissions") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("permissions")}</p>}
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}
