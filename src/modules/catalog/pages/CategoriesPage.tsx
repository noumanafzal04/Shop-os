import { useState, type FormEvent } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useCategories, useCategoryMutations } from "../hooks/useCatalog";
import type { Category } from "../types";

/** Depth-first flatten for the reassign / delete pickers. */
function flatten(nodes: Category[], depth = 0): Array<{ node: Category; depth: number }> {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flatten(n.children ?? [], depth + 1)]);
}

export default function CategoriesPage() {
  const categories = useCategories();
  const { create, update, remove, reorder } = useCategoryMutations();

  const [newName, setNewName] = useState("");
  const [addingUnder, setAddingUnder] = useState<string | null>(null); // parent id for inline sub-add
  const [subName, setSubName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const deleteModal = useModal();
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const roots = categories.data ?? [];
  const flat = flatten(roots);

  const createError =
    create.error instanceof ApiError ? create.error.firstFieldError() ?? create.error.message : null;

  const addRoot = (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || create.isPending) return;
    create.mutate({ name: newName.trim(), parent_id: null }, { onSuccess: () => setNewName("") });
  };

  const addSub = (parentId: string) => {
    if (!subName.trim() || create.isPending) return;
    create.mutate(
      { name: subName.trim(), parent_id: parentId },
      { onSuccess: () => { setSubName(""); setAddingUnder(null); } },
    );
  };

  const saveRename = (id: string) => {
    if (!renameValue.trim() || update.isPending) return;
    update.mutate({ id, name: renameValue.trim() }, { onSuccess: () => setRenaming(null) });
  };

  const toggleVisible = (c: Category) =>
    update.mutate({ id: c.id, is_active: !c.is_active });

  // Reorder within a sibling group by swapping and renumbering.
  const move = (siblings: Category[], index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= siblings.length) return;
    const arr = [...siblings];
    [arr[index], arr[j]] = [arr[j], arr[index]];
    reorder.mutate(arr.map((c, idx) => ({ id: c.id, parent_id: c.parent_id, sort_order: idx })));
  };

  const askDelete = (c: Category) => {
    setDeleteTarget(c);
    setReassignTo("");
    setDeleteError(null);
    deleteModal.openModal();
  };

  const doDelete = () => {
    if (!deleteTarget || remove.isPending) return;
    remove.mutate(
      { id: deleteTarget.id, reassignTo: reassignTo || undefined },
      {
        onSuccess: () => deleteModal.closeModal(),
        onError: (error) => setDeleteError(error instanceof ApiError ? error.message : "Delete failed."),
      },
    );
  };

  // Recursive node renderer.
  const renderNodes = (nodes: Category[], depth: number) =>
    nodes.map((c, i) => (
      <div key={c.id}>
        <div
          className="flex items-center justify-between gap-2 border-b border-gray-100 py-2.5 last:border-0 dark:border-gray-800"
          style={{ paddingLeft: depth * 22 }}
        >
          {renaming === c.id ? (
            <div className="flex flex-1 items-center gap-2 pr-4">
              <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
              <Button size="sm" onClick={() => saveRename(c.id)} disabled={update.isPending}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2">
                {depth > 0 && <span className="text-gray-300 dark:text-gray-600">↳</span>}
                <span className={`truncate text-sm font-medium ${c.is_active ? "text-gray-800 dark:text-white/90" : "text-gray-400 line-through"}`}>
                  {c.name}
                </span>
                {!!c.products_count && (
                  <span className="shrink-0 text-theme-xs text-gray-400">{c.products_count} item(s)</span>
                )}
                {!c.is_active && (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-theme-xs text-gray-500 dark:bg-gray-800">hidden</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm">
                {/* reorder */}
                <button className="text-gray-400 hover:text-gray-700 disabled:opacity-30" disabled={i === 0 || reorder.isPending} onClick={() => move(nodes, i, -1)} aria-label="Move up">↑</button>
                <button className="text-gray-400 hover:text-gray-700 disabled:opacity-30" disabled={i === nodes.length - 1 || reorder.isPending} onClick={() => move(nodes, i, 1)} aria-label="Move down">↓</button>
                <button className="text-gray-500 hover:text-brand-500" onClick={() => setAddingUnder(addingUnder === c.id ? null : c.id)}>+ Sub</button>
                <button className="text-gray-500 hover:text-gray-700 dark:text-gray-400" onClick={() => toggleVisible(c)}>
                  {c.is_active ? "Hide" : "Show"}
                </button>
                <button className="text-brand-500 hover:text-brand-600 dark:text-brand-400" onClick={() => { setRenaming(c.id); setRenameValue(c.name); }}>Rename</button>
                <button className="text-error-500 hover:text-error-600" onClick={() => askDelete(c)}>Delete</button>
              </div>
            </>
          )}
        </div>

        {/* Inline add-subcategory */}
        {addingUnder === c.id && (
          <div className="flex items-center gap-2 py-2" style={{ paddingLeft: (depth + 1) * 22 }}>
            <Input placeholder={`New subcategory under ${c.name}`} value={subName} onChange={(e) => setSubName(e.target.value)} />
            <Button size="sm" onClick={() => addSub(c.id)} disabled={create.isPending || !subName.trim()}>Add</Button>
            <Button size="sm" variant="outline" onClick={() => { setAddingUnder(null); setSubName(""); }}>Cancel</Button>
          </div>
        )}

        {c.children && c.children.length > 0 && renderNodes(c.children, depth + 1)}
      </div>
    ));

  return (
    <>
      <PageMeta title="Categories | ShopOS" description="Organize your catalog" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Categories</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Unlimited nesting — add subcategories at any level, reorder, and hide from your storefront.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form
          onSubmit={addRoot}
          className="h-fit rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Add top-level category</h3>
          {createError && (
            <div className="mb-3"><Alert variant="error" title="Couldn't add" message={createError} /></div>
          )}
          <div className="space-y-3">
            <Input placeholder="Category name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button size="sm" className="w-full" disabled={create.isPending || !newName.trim()}>
              {create.isPending ? "Adding…" : "Add category"}
            </Button>
            <p className="text-theme-xs text-gray-400">Use “+ Sub” on any row to nest deeper.</p>
          </div>
        </form>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:col-span-2">
          {categories.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              ))}
            </div>
          ) : roots.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No categories yet.</p>
          ) : (
            renderNodes(roots, 0)
          )}
        </div>
      </div>

      <Modal isOpen={deleteModal.isOpen} onClose={deleteModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          Delete "{deleteTarget?.name}"?
        </h3>
        {deleteError && (
          <div className="mb-3"><Alert variant="error" title="Blocked" message={deleteError} /></div>
        )}
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          If this category contains items, choose where to move them. Subcategories move up to this
          category's parent.
        </p>
        <div className="mb-6">
          <Select
            options={[
              { value: "", label: "Don't move items" },
              ...flat
                .filter((f) => f.node.id !== deleteTarget?.id)
                .map((f) => ({ value: f.node.id, label: `${"— ".repeat(f.depth)}Move items to ${f.node.name}` })),
            ]}
            placeholder="Don't move items"
            onChange={setReassignTo}
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={deleteModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={doDelete} disabled={remove.isPending}>
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
