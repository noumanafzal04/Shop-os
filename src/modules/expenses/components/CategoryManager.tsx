import { useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";

import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { Modal } from "../../../components/ui/modal";
import { useConfirm } from "../../../components/ui/confirm";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import type { CategoryInput } from "../services/expensesService";

interface Category {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
}

interface Props {
  title: string;
  hint: string;
  categories: Category[];
  loading: boolean;
  mutations: {
    create: UseMutationResult<unknown, Error, CategoryInput>;
    update: UseMutationResult<unknown, Error, { id: string } & CategoryInput>;
    remove: UseMutationResult<unknown, Error, string>;
  };
}

/**
 * The categories a business sorts its money into.
 *
 * They arrive seeded from the business type — a restaurant gets Ingredients
 * and Cooking Gas, a pharmacy gets Licensing — but that is a starting point,
 * not a vocabulary. Every shop has costs nobody else has, and until now the
 * seeded list was the whole language a business had to describe itself in,
 * forever. The screen even promised "yours to change" and offered no way to.
 *
 * Two rules, both from the server:
 *
 *   A category with entries filed under it is never deleted — deleting it
 *   would strand a year of history under a blank. It is TURNED OFF instead,
 *   which takes it out of the picker and leaves every past entry readable.
 *
 *   An empty category can be deleted outright, because nothing is lost.
 *
 * The server decides which case applies and says so; this screen relays that
 * sentence rather than guessing at it.
 */
export function CategoryManager({ title, hint, categories, loading, mutations }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const { isOpen, openModal, closeModal } = useModal();
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setEditing(null);
    setName("");
    setError(null);
    openModal();
  };

  const openEdit = (category: Category) => {
    setEditing(category);
    setName(category.name);
    setError(null);
    openModal();
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(null);
    const onError = (e: Error) => setError(e instanceof ApiError ? e.message : "Could not save");
    const onSuccess = () => {
      toast.success(editing ? "Category renamed" : "Category added");
      closeModal();
    };

    if (editing) {
      mutations.update.mutate({ id: editing.id, name: trimmed, is_active: editing.is_active }, { onSuccess, onError });
    } else {
      mutations.create.mutate({ name: trimmed }, { onSuccess, onError });
    }
  };

  const toggleActive = (category: Category) => {
    mutations.update.mutate(
      { id: category.id, name: category.name, is_active: !category.is_active },
      {
        onSuccess: () => toast.success(category.is_active ? "Turned off" : "Turned back on"),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not update"),
      },
    );
  };

  const remove = async (category: Category) => {
    const ok = await confirm({
      title: `Delete ${category.name}?`,
      message: "Categories with entries filed under them can't be deleted — turn them off instead.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;

    mutations.remove.mutate(category.id, {
      onSuccess: () => toast.success("Category deleted"),
      // The server's own sentence — it knows how many entries are filed under
      // this one and says so. Replacing it with "could not delete" throws away
      // the only part a merchant can act on.
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not delete"),
    });
  };

  const busy = mutations.create.isPending || mutations.update.isPending;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-white/90">{title}</h3>
          <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">{hint}</p>
        </div>
        <Button size="sm" onClick={openNew}>Add category</Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-theme-sm text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">
          No categories yet — add the first one.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {categories.map((category) => (
            <li key={category.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span
                className={`flex-1 text-theme-sm font-medium ${
                  category.is_active
                    ? "text-gray-800 dark:text-white/90"
                    : "text-gray-400 line-through dark:text-gray-500"
                }`}
              >
                {category.name}
              </span>

              {!category.is_active && <Badge size="sm" color="light">Off</Badge>}
              {category.is_default && <Badge size="sm" color="info">From your trade</Badge>}

              <button
                type="button"
                onClick={() => openEdit(category)}
                className="text-theme-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => toggleActive(category)}
                className="text-theme-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
              >
                {category.is_active ? "Turn off" : "Turn on"}
              </button>
              <button
                type="button"
                onClick={() => remove(category)}
                className="text-theme-xs font-medium text-error-500 hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-md p-6">
        <h4 className="mb-4 font-semibold text-gray-800 dark:text-white/90">
          {editing ? "Rename category" : "New category"}
        </h4>

        {/* A form so Enter saves — the name is one field and reaching for the
            mouse to commit it is a small insult repeated twenty times. */}
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Chai for customers"
          />
          {error && <p className="mt-1 text-theme-xs text-error-500">{error}</p>}

          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={closeModal}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!name.trim() || busy}>
              {busy ? "Saving…" : editing ? "Save" : "Add"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
