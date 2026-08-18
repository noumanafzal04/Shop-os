import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import Badge from "../../../components/ui/badge/Badge";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useToast } from "../../../components/ui/toast";
import { useAnnouncements, useAnnouncementMutations } from "../hooks/useAdmin";
import type { Announcement } from "../services/adminService";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";

const AUDIENCE_LABEL: Record<string, string> = {
  tenants: "All shops",
  customers: "All customers",
  all: "Everyone",
};

export default function AdminAnnouncementsPage() {
  const confirm = useConfirm();
  const announcements = useAnnouncements();
  const { create, update, send, remove } = useAnnouncementMutations();
  const editor = useModal();
  const toast = useToast();

  /**
   * A delete that fails silently is the worst version of this: the row simply
   * stays, and the shopkeeper is left pressing Delete on something that will
   * never go. Most refusals here are a REASON — a announcement still referenced by
   * something else — so the server's message is what gets shown.
   */
  const removeWithFeedback = (id: string, name: string) =>
    remove.mutate(id, {
      onSuccess: () => toast.success(`${name} deleted`),
      onError: (e) => toast.error(e instanceof Error ? e.message : `Couldn't delete this announcement.`),
    });


  const [editing, setEditing] = useState<Announcement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ audience: "tenants" });

  const mutation = editing ? update : create;
  const err = mutation.error instanceof ApiError ? mutation.error.firstFieldError() ?? mutation.error.message : null;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const pickFile = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const openCreate = () => {
    setEditing(null); pickFile(null);
    setForm({ audience: "tenants", title: "", body: "", link: "" });
    editor.openModal();
  };
  const openEdit = (a: Announcement) => {
    setEditing(a); pickFile(null);
    setForm({ title: a.title, body: a.body, audience: a.audience, link: a.link ?? "" });
    editor.openModal();
  };

  const save = () => {
    if (mutation.isPending) return;
    const fd = new FormData();
    if (file) fd.append("image", file);
    fd.append("audience", form.audience || "tenants");
    for (const k of ["title", "body", "link"]) {
      if (form[k]) fd.append(k, form[k]);
    }
    const opts = { onSuccess: () => editor.closeModal() };
    if (editing) update.mutate({ id: editing.id, data: fd }, opts);
    else create.mutate(fd, opts);
  };

  const onSend = async (a: Announcement) => {
    const who = AUDIENCE_LABEL[a.audience] ?? a.audience;
    const verb = a.is_published ? "Re-send" : "Send";
    if (await confirm({
      title: `${verb} "${a.title}"?`,
      message: `It goes to ${who} as a push notification. This cannot be unsent.`,
      confirmLabel: verb,
    })) send.mutate(a.id);
  };

  const rows = announcements.data ?? [];

  return (
    <>
      <PageMeta title="Announcements | ShopOS Admin" description="Broadcast push notifications" />
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Announcements</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Broadcast a push notification to shops or customers. Draft first, then send.</p>
        </div>
        <Button size="sm" onClick={openCreate}>+ New announcement</Button>
      </div>

      {announcements.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No announcements yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => (
            <div key={a.id} className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
              {a.image_url && <img src={a.image_url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800 dark:text-white/90">{a.title}</span>
                  <Badge size="sm" color="info">{AUDIENCE_LABEL[a.audience] ?? a.audience}</Badge>
                  {a.is_published ? (
                    <Badge size="sm" color="success">sent · {a.recipients_count}</Badge>
                  ) : (
                    <Badge size="sm" color="light">draft</Badge>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{a.body}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 text-sm">
                <button className={ROW_ACTION} onClick={() => onSend(a)} disabled={send.isPending}>
                  {a.is_published ? "Re-send" : "Send now"}
                </button>
                <div className="flex gap-3">
                  <button className={ROW_ACTION} onClick={() => openEdit(a)}>Edit</button>
                  <button className={ROW_ACTION_DANGER} onClick={async () => {
                    if (await confirm({ title: "Delete announcement?", confirmLabel: "Delete", tone: "danger" })) removeWithFeedback(a.id, "Announcement");
                  }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={editor.isOpen} onClose={editor.closeModal} className="max-w-lg p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{editing ? "Edit announcement" : "New announcement"}</h3>
        {err && <div className="mb-3"><Alert variant="error" title="Couldn't save" message={err} /></div>}
        <div className="space-y-3">
          <Input placeholder="Title" value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} />
          <TextArea placeholder="Message body" rows={4} value={form.body ?? ""} onChange={(v) => set("body", v)} />
          <div>
            <label className="mb-1 block text-theme-xs text-gray-400">Audience</label>
            <Select defaultValue={form.audience} options={[{ value: "tenants", label: "All shops" }, { value: "customers", label: "All customers" }, { value: "all", label: "Everyone" }]} placeholder="Audience" onChange={(v) => set("audience", v)} />
          </div>
          <Input placeholder="Deep-link or URL on tap (optional)" value={form.link ?? ""} onChange={(e) => set("link", e.target.value)} />
          <div>
            <label className="mb-1 block text-theme-xs text-gray-400">Image {editing && "(leave empty to keep)"}</label>
            {(preview || (editing && editing.image_url)) && (
              <img src={preview ?? editing?.image_url ?? ""} alt="preview" className="mb-2 h-28 w-full rounded-lg border border-gray-200 object-cover dark:border-gray-700" />
            )}
            <input type="file" accept="image/*" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <p className="text-theme-xs text-gray-400">Saved as a draft. Use “Send now” on the list to push it out.</p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={editor.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save draft"}</Button>
        </div>
      </Modal>
    </>
  );
}
