import { useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import Button from "../../components/ui/button/Button";
import Badge from "../../components/ui/badge/Badge";
import Input from "../../components/form/input/InputField";
import Label from "../../components/form/Label";
import Alert from "../../components/ui/alert/Alert";
import { Modal } from "../../components/ui/modal";
import { useModal } from "../../hooks/useModal";
import { ApiError } from "../../common/types/api";
import { useDebouncedValue } from "../../common/hooks/useDebouncedValue";
import type { User } from "../auth/types";
import { useStaffModule, type StaffInput } from "./hooks/useStaff";
import { labelFor } from "./permissions";

interface Props {
  title: string;
  subtitle: string;
  basePath: string; // "/admin/staff" | "/staff"
}

export default function StaffPage({ title, subtitle, basePath }: Props) {
  const staff = useStaffModule(basePath);
  const permissions = staff.usePermissionCatalog();
  const presets = staff.useJobPresets();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const list = staff.useStaffList({ search: useDebouncedValue(search, 350), page });

  const modal = useModal();
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
        { onSuccess: modal.closeModal },
      );
    } else {
      staff.create.mutate({ ...base, password: form.password } as StaffInput, { onSuccess: modal.closeModal });
    }
  };

  const toggleSuspend = (u: User) =>
    staff.update.mutate({ id: u.id, status: u.status === "active" ? "suspended" : "active" });

  const remove = (u: User) => {
    if (window.confirm(`Remove ${u.name}? Their sessions end immediately.`)) {
      staff.remove.mutate(u.id, { onError: (e) => window.alert(e instanceof ApiError ? e.message : "Delete failed.") });
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
                            {labelFor(p)}
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
                      <button className="mr-3 text-brand-500 hover:text-brand-600 dark:text-brand-400" onClick={() => openEdit(u)}>Edit</button>
                      <button className="mr-3 text-gray-500 hover:text-gray-700 dark:text-gray-400" onClick={() => toggleSuspend(u)}>
                        {u.status === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button className="text-error-500 hover:text-error-600" onClick={() => remove(u)}>Remove</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 text-sm dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">{pagination.total} staff · page {pagination.current_page} of {pagination.last_page}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pagination.current_page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Create / edit */}
      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? `Edit ${editing.name}` : "Add Staff"}
        </h3>
        {generalError && <div className="mb-4"><Alert variant="error" title="Couldn't save" message={generalError} /></div>}

        <div className="space-y-4">
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

            <Label>Permissions <span className="text-error-500">*</span></Label>
            <div className="mt-1 grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800 sm:grid-cols-2">
              {catalog.map((key) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" className="h-4 w-4" checked={form.permissions.includes(key)} onChange={() => togglePerm(key)} />
                  {labelFor(key)}
                </label>
              ))}
            </div>
            {errorFor("permissions") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("permissions")}</p>}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={mutation.isPending || !form.name.trim() || form.permissions.length === 0 || (!editing && !form.password) || (!editing && !form.email.trim() && !form.phone.trim())}
          >
            {mutation.isPending ? "Saving…" : editing ? "Save changes" : "Add staff"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
