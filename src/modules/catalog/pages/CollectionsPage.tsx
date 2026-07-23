import { useEffect, useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import {
  useCollection,
  useCollectionMutations,
  useCollections,
  useProducts,
} from "../hooks/useCatalog";
import type { Collection } from "../types";

export default function CollectionsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const collections = useCollections();
  const { create, update, remove } = useCollectionMutations();
  const editor = useModal();

  const [editId, setEditId] = useState<string | null>(null);
  const detail = useCollection(editId ?? undefined);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [visible, setVisible] = useState(true);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const products = useProducts({ search: search || undefined });
  const rows = products.data?.data ?? [];
  const mutation = editId ? update : create;
  const err = mutation.error instanceof ApiError ? mutation.error.firstFieldError() ?? mutation.error.message : null;

  // Hydrate item list when editing.
  useEffect(() => {
    if (editId && detail.data) {
      setName(detail.data.name);
      setDescription(detail.data.description ?? "");
      setActive(detail.data.is_active);
      setVisible(detail.data.visible_in_marketplace);
      setItemIds((detail.data.items ?? []).map((i) => i.id));
    }
  }, [editId, detail.data]);

  const openCreate = () => {
    setEditId(null);
    setName(""); setDescription(""); setActive(true); setVisible(true); setItemIds([]); setSearch("");
    editor.openModal();
  };

  const openEdit = (c: Collection) => {
    setEditId(c.id);
    setSearch("");
    editor.openModal();
  };

  const toggleItem = (id: string) =>
    setItemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = () => {
    if (!name.trim() || mutation.isPending) return;
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      is_active: active,
      visible_in_marketplace: visible,
      item_ids: itemIds,
    };
    const opts = { onSuccess: () => editor.closeModal() };
    if (editId) update.mutate({ id: editId, ...payload }, opts);
    else create.mutate(payload, opts);
  };

  if (!hasPermission("products.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage the catalog." />;
  }

  const list = collections.data ?? [];

  return (
    <>
      <PageMeta title="Collections | ShopOS" description="Display sections for your storefront" />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Collections</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Display sections like Popular, Deals, or New Arrivals — shown in your online shop.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>+ New collection</Button>
      </div>

      {collections.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No collections yet.</p>
          <Button size="sm" className="mt-3" onClick={openCreate}>Create your first collection</Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => (
            <div key={c.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800 dark:text-white/90">{c.name}</h3>
                <div className="flex gap-1">
                  {!c.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-theme-xs text-gray-500 dark:bg-gray-800">hidden</span>}
                  {c.visible_in_marketplace && c.is_active && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-theme-xs text-brand-600 dark:bg-brand-500/10">online</span>}
                </div>
              </div>
              {c.description && <p className="mb-3 line-clamp-2 text-theme-xs text-gray-400">{c.description}</p>}
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{c.items_count ?? 0} item(s)</p>
              <div className="flex gap-3 text-sm">
                <button className="text-brand-500 hover:text-brand-600 dark:text-brand-400" onClick={() => openEdit(c)}>Edit</button>
                <button
                  className="text-error-500 hover:text-error-600"
                  onClick={() => { if (confirm(`Delete collection "${c.name}"?`)) remove.mutate(c.id); }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <Modal isOpen={editor.isOpen} onClose={editor.closeModal} className="max-w-2xl p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editId ? "Edit collection" : "New collection"}
        </h3>
        {err && <div className="mb-3"><Alert variant="error" title="Couldn't save" message={err} /></div>}

        <div className="space-y-4">
          <Input placeholder="Name e.g. Popular, Deals" value={name} onChange={(e) => setName(e.target.value)} />
          <TextArea placeholder="Optional description" value={description} onChange={setDescription} rows={2} />

          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Show in online shop
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Items ({itemIds.length} selected)</span>
              <Input placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2 dark:border-gray-800">
              {rows.length === 0 ? (
                <p className="py-4 text-center text-theme-xs text-gray-400">No items found.</p>
              ) : (
                rows.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5">
                    <input type="checkbox" checked={itemIds.includes(p.id)} onChange={() => toggleItem(p.id)} />
                    <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{p.name}</span>
                    <span className="text-theme-xs text-gray-400">Rs {Number(p.price).toLocaleString()}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={editor.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? "Saving…" : editId ? "Save changes" : "Create collection"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
