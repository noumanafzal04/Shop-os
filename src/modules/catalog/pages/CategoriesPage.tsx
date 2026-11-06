import { useMemo, useState, type FormEvent } from "react";
import { useToast } from "../../../components/ui/toast";
import { failed } from "../../../common/api/failed";
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
import { CategoryTree } from "../components/CategoryTree";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useAuthStore } from "../../../stores/authStore";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches } from "../../branches/hooks/useBranches";
import { byKind, hasSecondShop } from "../../branches/places";
import { SoldAtField } from "../../branches/components/SoldAtField";
import { ANY_BRANCH, soldAtForNew, soldAtOf, soldAtPayload, type SoldAt } from "../../branches/soldAt";

/** Depth-first flatten for the reassign picker and the counts. */
function flatten(nodes: Category[], depth = 0): Array<{ node: Category; depth: number }> {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flatten(n.children ?? [], depth + 1)]);
}

/**
 * The tree, keeping any branch that leads to a match.
 *
 * A subcategory found by search is meaningless without the parents above it —
 * "Juices" tells you nothing until you can see it sits under "Drinks" and not
 * under "Cleaning".
 */
function filterTree(nodes: Category[], needle: string): Category[] {
  const q = needle.trim().toLowerCase();
  if (!q) return nodes;

  return nodes.flatMap((n) => {
    const kids = filterTree(n.children ?? [], q);
    const hit = n.name.toLowerCase().includes(q);

    return hit || kids.length > 0 ? [{ ...n, children: hit ? n.children : kids }] : [];
  });
}

export default function CategoriesPage() {
  const categories = useCategories();
  const { create, update, remove, reorder } = useCategoryMutations();
  // The Add and Delete paths render `create.error` and `deleteError` in an
  // Alert, which is right for a form. Renaming, hiding and reordering happen
  // inline in the tree with no form to put an Alert under — so those speak
  // through a toast instead of snapping back in silence.
  const toast = useToast();

  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");

  // Where a category is shown (v2, branches/soldAt) — only once a second
  // branch sells. `newSoldAt` is null until touched: the server's rule stands.
  const twoShops = hasSecondShop(useShopSettings().data);
  const branches = useBranches(twoShops);
  const chooses = useAuthStore((s) => s.hasPermission(ANY_BRANCH));
  const isOwner = useAuthStore((s) => s.user?.role === "shop_owner");
  const ownBranch = useAuthStore((s) => s.user?.branch_id ?? null);
  const branchNames = useMemo(
    () => (twoShops ? new Map(byKind((branches.data ?? []).filter((b) => b.is_active)).shops.map((b) => [b.id, b.name] as const)) : undefined),
    [twoShops, branches.data],
  );
  const [newSoldAt, setNewSoldAt] = useState<SoldAt | null>(null);
  const placesModal = useModal();
  const [placesOf, setPlacesOf] = useState<Category | null>(null);
  const [placesNext, setPlacesNext] = useState<SoldAt | null>(null);
  const placesError = update.error instanceof ApiError && placesModal.isOpen ? update.error.message : null;

  const deleteModal = useModal();
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const roots = useMemo(() => categories.data ?? [], [categories.data]);
  const shown = useMemo(() => filterTree(roots, search), [roots, search]);
  const flat = useMemo(() => flatten(roots), [roots]);

  const createError =
    create.error instanceof ApiError ? create.error.firstFieldError() ?? create.error.message : null;

  const addRoot = (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || create.isPending) return;
    create.mutate(
      { name: newName.trim(), parent_id: null, ...soldAtPayload(newSoldAt) },
      { onSuccess: () => { setNewName(""); setNewSoldAt(null); } },
    );
  };

  const askPlaces = (c: Category) => {
    update.reset();
    setPlacesOf(c);
    setPlacesNext(null);
    placesModal.openModal();
  };

  const savePlaces = () => {
    if (!placesOf || placesNext === null || update.isPending) return placesModal.closeModal();
    update.mutate({ id: placesOf.id, ...soldAtPayload(placesNext) }, { onSuccess: () => placesModal.closeModal() });
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
        onError: (error) =>
          setDeleteError(error instanceof ApiError ? error.message : "Delete failed."),
      },
    );
  };

  return (
    <>
      <PageMeta title="Categories" description="Organize your catalog" />

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Categories</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Drag a row by its handle to change the order customers and your till see. Nest as deep as
          you like.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form
          onSubmit={addRoot}
          className="h-fit rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">
            Add top-level category
          </h3>
          {createError && (
            <div className="mb-3">
              <Alert variant="error" title="Couldn't add" message={createError} />
            </div>
          )}
          <div className="space-y-3">
            <Input
              placeholder="Category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <SoldAtField noun="category" value={newSoldAt ?? soldAtForNew(isOwner, ownBranch)} onChange={setNewSoldAt} />
            <Button type="submit" size="sm" className="w-full" disabled={create.isPending || !newName.trim()}>
              {create.isPending ? "Adding…" : "Add category"}
            </Button>
            <p className="text-theme-xs text-gray-400">
              Use <span className="font-medium text-gray-500">Add sub</span> on any row to nest
              deeper.
            </p>
          </div>

          {flat.length > 0 && (
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
              <div>
                <dt className="text-theme-xs text-gray-400">Categories</dt>
                <dd className="text-lg font-semibold tabular-nums text-gray-800 dark:text-white/90">
                  {flat.length}
                </dd>
              </div>
              <div>
                <dt className="text-theme-xs text-gray-400">Hidden</dt>
                <dd className="text-lg font-semibold tabular-nums text-gray-800 dark:text-white/90">
                  {flat.filter((f) => !f.node.is_active).length}
                </dd>
              </div>
            </dl>
          )}
        </form>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-gray-800 dark:text-white/90">
              Your categories
              {search.trim() !== "" && (
                <span className="ml-2 text-theme-xs font-normal text-gray-400">
                  order locked while searching
                </span>
              )}
            </h3>
            {flat.length > 6 && (
              <div className="w-full sm:w-56">
                <Input
                  placeholder="Find a category…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
          </div>

          {categories.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
              ))}
            </div>
          ) : roots.length === 0 ? (
            <ListEmpty from={categories} what="the categories">
              <div className="py-10 text-center">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  No categories yet
                </p>
                <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
                  Add your first one on the left — “Drinks”, “Bakery”, whatever your shelves are
                  called.
                </p>
              </div>
            </ListEmpty>
          ) : shown.length === 0 ? (
            <ListEmpty from={categories} what="the categories">
              <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                Nothing matches “{search}”.
              </p>
            </ListEmpty>
          ) : (
            <CategoryTree
              roots={shown}
              handlers={{
                busy: create.isPending || update.isPending || reorder.isPending,
                // Never while filtered — see `canReorder`. Dragging inside a
                // search would renumber the rows the search is hiding.
                canReorder: search.trim() === "",
                // The row redraws from the cache on success and simply snaps
                // back on failure, which reads as a slow save rather than a
                // refused one.
                onRename: (c, name) => update.mutate({ id: c.id, name }, failed(toast, "That category was not renamed.")),
                onToggleVisible: (c) => update.mutate(
                  { id: c.id, is_active: !c.is_active },
                  failed(toast, `"${c.name}" is unchanged — it is still ${c.is_active ? "visible" : "hidden"}.`),
                ),
                onAddSub: (parentId, name) => create.mutate({ name, parent_id: parentId }),
                branchNames,
                onBranches: branchNames && chooses ? askPlaces : undefined,
                onDelete: askDelete,
                onReorder: (rows) => reorder.mutate(rows, failed(toast, "The new order was not saved.")),
              }}
            />
          )}
        </div>
      </div>

      <Modal isOpen={placesModal.isOpen} onClose={placesModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          Where is "{placesOf?.name}" shown?
        </h3>
        {placesError && (
          <div className="mb-3">
            <Alert variant="error" title="Not saved" message={placesError} />
          </div>
        )}
        <SoldAtField noun="category" value={placesNext ?? soldAtOf(placesOf)} onChange={setPlacesNext} existing={placesOf} />
        <p className="mt-3 text-theme-xs text-gray-400">
          A branch also shows this category while it sells any item in it.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={placesModal.closeModal}>
            Cancel
          </Button>
          <Button size="sm" onClick={savePlaces} disabled={update.isPending || placesNext === null}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={deleteModal.isOpen} onClose={deleteModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          Delete "{deleteTarget?.name}"?
        </h3>
        {deleteError && (
          <div className="mb-3">
            <Alert variant="error" title="Blocked" message={deleteError} />
          </div>
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
                .map((f) => ({
                  value: f.node.id,
                  label: `${"— ".repeat(f.depth)}Move items to ${f.node.name}`,
                })),
            ]}
            placeholder={null}
            onChange={setReassignTo}
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={deleteModal.closeModal}>
            Cancel
          </Button>
          {/* Filled red, matching the shared confirm dialog — see
              ProductsPage. This one keeps its own modal because it asks a
              second question: where the category's items should go. */}
          <button
            onClick={doDelete}
            disabled={remove.isPending}
            className="rounded-lg bg-error-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-error-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </Modal>
    </>
  );
}
