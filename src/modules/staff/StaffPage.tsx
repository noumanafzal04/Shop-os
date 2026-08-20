import { useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import Button from "../../components/ui/button/Button";
import Badge from "../../components/ui/badge/Badge";
import Input from "../../components/form/input/InputField";
import Label from "../../components/form/Label";
import Alert from "../../components/ui/alert/Alert";
import { Modal, ModalForm } from "../../components/ui/modal";
import { useToast } from "../../components/ui/toast";
import { useModal } from "../../hooks/useModal";
import { ApiError } from "../../common/types/api";
import { useDebouncedValue } from "../../common/hooks/useDebouncedValue";
import type { User } from "../auth/types";
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

export default function StaffPage({ title, subtitle, basePath }: Props) {
  const confirm = useConfirm();
  const staff = useStaffModule(basePath);
  const permissions = staff.usePermissionCatalog();
  const presets = staff.useJobPresets();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const list = staff.useStaffList({ search: useDebouncedValue(search, 350), page });

  const modal = useModal();
  const toast = useToast();
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<{ name: string; email: string; phone: string; password: string; permissions: string[] }>({
    name: "", email: "", phone: "", password: "", permissions: [],
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

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

  // "Everything" means every box the catalog offers, not merely a non-empty
  // list — so the warning below cannot fire on a staffer who happens to hold
  // a lot of permissions.
  const allChecked =
    catalog.length > 0 && catalog.every((p) => form.permissions.includes(p.key));
  const isTenantSide = basePath === "/staff";
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
    setForm({ name: "", email: "", phone: "", password: "", permissions: [] });
    staff.create.reset();
    modal.openModal();
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({ name: u.name, email: u.email ?? "", phone: u.phone ?? "", password: "", permissions: u.permissions ?? [] });
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

  return (
    <>
      <PageMeta title={`${title} | ShopOS`} description={subtitle} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">{title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        <Button size="sm" onClick={openCreate}>+ Add Staff</Button>
      </div>

      <div className="mb-4 max-w-sm">
        <Input placeholder="Search name, email, phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Contact</th>
                <th className="px-6 py-3 font-medium">Permissions</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {list.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-6 py-4"><div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">No staff yet — add your first team member.</td></tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">{u.name}</td>
                    <td className="px-6 py-4 text-theme-xs">{u.email ?? u.phone ?? "—"}</td>
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
                      <button className={ROW_ACTION} onClick={() => openEdit(u)}>Edit</button>
                      <button className={ROW_ACTION} onClick={() => toggleSuspend(u)}>
                        {u.status === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button className={ROW_ACTION_DANGER} onClick={() => remove(u)}>Remove</button>
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
                  onClick={() => setForm((f) => ({ ...f, permissions: catalog.map((p) => p.key) }))}
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
              {catalog.map(({ key }) => {
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
            {errorFor("permissions") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("permissions")}</p>}
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}
