import { useMemo, useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";

import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
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
  /** How many entries are filed here — why a used category can't be deleted. */
  entries_count?: number;
  entries_total?: number;
}

interface Props {
  title: string;
  hint: string;
  categories: Category[];
  loading: boolean;
  money: (n: number | string) => string;
  /** "expense" / "income" — used in the copy so the screen speaks plainly. */
  noun: string;
  mutations: {
    create: UseMutationResult<unknown, Error, CategoryInput>;
    update: UseMutationResult<unknown, Error, { id: string } & CategoryInput>;
    remove: UseMutationResult<unknown, Error, string>;
  };
}

type Status = "all" | "live" | "off";
type Sort = "name" | "used" | "spend";

/**
 * Below this the list IS the control: seven rows are read faster than a search
 * box is typed into, and a toolbar over them is furniture. Above it, scanning
 * stops working and the tools have to be there.
 */
const TOOLBAR_FROM = 7;

/** How many rows are drawn before the reader asks for more. */
const PAGE = 24;

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "name", label: "A–Z" },
  { value: "used", label: "Most used" },
  { value: "spend", label: "Highest total" },
];

/**
 * The categories a business sorts its money into.
 *
 * They arrive seeded from the business type — a restaurant gets Ingredients
 * and Cooking Gas, a pharmacy gets Licensing — but that is a starting point,
 * not a vocabulary. Every shop has costs nobody else has.
 *
 * Two rules, both the server's:
 *
 *   A category with entries filed under it is never deleted — deleting it
 *   would strand a year of history under a blank. It is TURNED OFF instead,
 *   which stops anything new being filed there and leaves the past readable.
 *
 *   An empty category deletes outright, because nothing is lost.
 *
 * The list says which case a row is in BEFORE anyone clicks: the entry count
 * is right there, so "why can't I delete Rent?" is answered by looking. A row
 * that can't be deleted doesn't offer a Delete button at all — offering an
 * action that always fails is worse than not offering it.
 *
 * Live and retired are separated, because they answer different questions:
 * the live list is "where can today's bill go", the retired one is "what did
 * we used to call things". Interleaved, neither reads.
 *
 * SCALE. A books-only business is the whole reason this screen exists, and
 * theirs is the longest list — a Finance Manager tenant is seeded with twenty
 * and an accountant will happily keep a hundred and fifty. Drawing all of them
 * flat, with a search box that only appeared past eight rows and nothing else,
 * turned the one screen they live in into a page you scroll for ten seconds to
 * find "Bank Charges". So the toolbar carries the three questions actually
 * asked of a long list — WHICH one ("Find a category"), WHICH KIND (in use vs
 * switched off) and WHAT MATTERS MOST (biggest spender first) — and the rows
 * are drawn a page at a time, because rendering three hundred list items to
 * show twenty-four of them costs the reader nothing and the browser plenty.
 */
export function CategoryManager({ title, hint, categories, loading, money, noun, mutations }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const { isOpen, openModal, closeModal } = useModal();
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [limit, setLimit] = useState(PAGE);

  const liveCount = categories.filter((c) => c.is_active).length;
  const retiredCount = categories.length - liveCount;
  // Past this many, scanning stops being a strategy.
  const roomy = categories.length >= TOOLBAR_FROM;

  const { live, retired, matched } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hits = q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories;

    // Ordered once, here, so the two sections cannot end up sorted differently.
    const ordered = [...hits].sort((a, b) => {
      if (sort === "used") return (b.entries_count ?? 0) - (a.entries_count ?? 0) || a.name.localeCompare(b.name);
      if (sort === "spend") return (b.entries_total ?? 0) - (a.entries_total ?? 0) || a.name.localeCompare(b.name);

      return a.name.localeCompare(b.name);
    });

    return {
      live: status === "off" ? [] : ordered.filter((c) => c.is_active),
      retired: status === "live" ? [] : ordered.filter((c) => !c.is_active),
      matched: ordered.filter((c) => (status === "live" ? c.is_active : status === "off" ? !c.is_active : true)).length,
    };
  }, [categories, search, status, sort]);

  // Each section pages independently, or a shop with two hundred live
  // categories could never reach the retired ones at all.
  const liveShown = live.slice(0, limit);
  const retiredShown = retired.slice(0, limit);
  const hidden = live.length - liveShown.length + (retired.length - retiredShown.length);

  /** Any change to what is being asked returns the list to its first page. */
  const narrow = (fn: () => void) => {
    fn();
    setLimit(PAGE);
  };

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

  const toggleActive = async (category: Category) => {
    // Turning one off is the consequential direction — nothing new can be
    // filed there afterwards — so it asks, and says what stays true.
    if (category.is_active) {
      const used = category.entries_count ?? 0;
      const ok = await confirm({
        title: `Turn off ${category.name}?`,
        message: used > 0
          ? `New ${noun}s can't be filed here any more. The ${used} already filed under it stay exactly as they are, and you can still filter by it.`
          : `It disappears from the ${noun} form. Turn it back on any time.`,
        confirmLabel: "Turn off",
      });
      if (!ok) return;
    }

    mutations.update.mutate(
      { id: category.id, name: category.name, is_active: !category.is_active },
      {
        onSuccess: () => toast.success(category.is_active ? `${category.name} turned off` : `${category.name} is back on`),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not update"),
      },
    );
  };

  const remove = async (category: Category) => {
    const ok = await confirm({
      title: `Delete ${category.name}?`,
      message: `Nothing is filed under it, so nothing is lost. This can't be undone.`,
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

  const row = (category: Category) => (
    <CategoryRow
      key={category.id}
      category={category}
      money={money}
      noun={noun}
      onRename={() => openEdit(category)}
      onToggle={() => toggleActive(category)}
      onDelete={() => remove(category)}
    />
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">{title}</h3>
          <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">{hint}</p>
        </div>
        <Button size="sm" onClick={openNew} className="shrink-0">+ Add category</Button>
      </div>

      {roomy && (
        <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-56 flex-1">
              <Input
                placeholder="Find a category…"
                value={search}
                onChange={(e) => narrow(() => setSearch(e.target.value))}
              />
            </div>

            {/* Two questions, not three: "everything", "where today's bill can
                go", "what we used to call things". */}
            <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800/60">
              {([
                ["all", "All", categories.length],
                ["live", "In use", liveCount],
                ["off", "Switched off", retiredCount],
              ] as Array<[Status, string, number]>).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={status === value}
                  onClick={() => narrow(() => setStatus(value))}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-theme-xs font-medium transition ${
                    status === value
                      ? "bg-brand-500 text-white shadow-theme-xs"
                      : "text-gray-500 hover:bg-white/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5"
                  }`}
                >
                  {label} <span className="tabular-nums opacity-70">{count}</span>
                </button>
              ))}
            </div>

            <div className="w-40">
              <Select
                options={SORTS}
                value={sort}
                onChange={(v) => narrow(() => setSort(v as Sort))}
              />
            </div>
          </div>

          {/* What you are looking at, out of what there is. Without it a paged
              list looks like a short one. */}
          <p className="mt-3 border-t border-gray-100 pt-3 text-theme-xs text-gray-400 dark:border-gray-800">
            {matched === categories.length
              ? `${categories.length} categories`
              : `${matched} of ${categories.length} categories`}
            {hidden > 0 && ` · showing ${matched - hidden}`}
            {(search.trim() !== "" || status !== "all") && (
              <button
                type="button"
                onClick={() => narrow(() => { setSearch(""); setStatus("all"); })}
                className="ml-2 text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
              >
                Clear
              </button>
            )}
          </p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
          <p className="text-theme-sm font-medium text-gray-700 dark:text-gray-200">No categories yet</p>
          <p className="mx-auto mt-1 max-w-sm text-theme-sm text-gray-500 dark:text-gray-400">
            Categories are how you'll read your own books later — start with the three or four you
            spend on most.
          </p>
          <Button size="sm" onClick={openNew} className="mt-4">+ Add the first one</Button>
        </div>
      ) : matched === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-theme-sm text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">
          {search.trim() !== ""
            ? `Nothing matches “${search}”.`
            : status === "off"
              ? "Nothing is switched off."
              : "Nothing is in use."}
        </p>
      ) : (
        <div className="space-y-6">
          {liveShown.length > 0 && (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {liveShown.map(row)}
            </ul>
          )}

          {retiredShown.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-theme-xs font-semibold uppercase tracking-wide text-gray-400">
                  Switched off
                </h4>
                <span className="text-theme-xs text-gray-400">
                  — kept so their history stays readable and searchable
                </span>
              </div>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 dark:divide-gray-800 dark:border-gray-700 dark:bg-white/[0.02]">
                {retiredShown.map(row)}
              </ul>
            </div>
          )}

          {hidden > 0 && (
            <div className="flex justify-center">
              <Button size="sm" variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
                Show {Math.min(hidden, PAGE)} more
              </Button>
            </div>
          )}
        </div>
      )}

      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-md p-6">
        <h4 className="mb-1 font-semibold text-gray-800 dark:text-white/90">
          {editing ? `Rename ${editing.name}` : "New category"}
        </h4>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          {editing
            ? "Every entry already filed here follows the new name."
            : `Name it the way you'd say it out loud — that's what you'll be scanning for later.`}
        </p>

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
              {busy ? "Saving…" : editing ? "Save changes" : "Add category"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/**
 * One category.
 *
 * The actions are real buttons rather than three identical text links — Delete
 * used to sit inches from Turn off in the same weight and colour, which is a
 * mis-click waiting to happen on the one action that can't be undone. Now
 * Rename is the ordinary one, the on/off switch reads as a state rather than a
 * command, and Delete is separated, tinted, and only present when it can
 * actually work.
 */
function CategoryRow({
  category,
  money,
  noun,
  onRename,
  onToggle,
  onDelete,
}: {
  category: Category;
  money: (n: number | string) => string;
  noun: string;
  onRename: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const used = category.entries_count ?? 0;
  const total = category.entries_total ?? 0;
  // The server refuses to delete a category with history, so the button that
  // would always fail is simply not drawn.
  const deletable = used === 0;

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`truncate text-theme-sm font-medium ${
              category.is_active ? "text-gray-800 dark:text-white/90" : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {category.name}
          </span>
          {category.is_default && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
              From your trade
            </span>
          )}
        </div>
        <p className="mt-0.5 text-theme-xs text-gray-400">
          {used === 0
            ? `Nothing filed here yet`
            : `${used} ${noun}${used === 1 ? "" : "s"} · ${money(total)}`}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRename}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-theme-xs font-medium text-gray-700 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-gray-700 dark:text-gray-200 dark:hover:border-brand-500/50"
        >
          Rename
        </button>

        {/* State, not command: the pill shows what the category IS, and
            pressing it changes that. `aria-pressed` carries the same thing to
            a screen reader. */}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={category.is_active}
          title={category.is_active
            ? `In use — new ${noun}s can be filed here`
            : `Switched off — nothing new can be filed here`}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-theme-xs font-medium transition-colors ${
            category.is_active
              ? "border-success-200 bg-success-50 text-success-700 hover:border-success-300 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400"
              : "border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              category.is_active ? "bg-success-500" : "bg-gray-400"
            }`}
          />
          {category.is_active ? "In use" : "Off"}
        </button>

        {deletable ? (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-transparent px-3 py-1.5 text-theme-xs font-medium text-gray-400 transition-colors hover:border-error-200 hover:bg-error-50 hover:text-error-600 dark:hover:border-error-500/30 dark:hover:bg-error-500/10"
          >
            Delete
          </button>
        ) : (
          <span
            title={`${used} ${noun}${used === 1 ? "" : "s"} filed here — turn it off instead, and the history stays readable`}
            className="cursor-help px-3 py-1.5 text-theme-xs text-gray-300 dark:text-gray-600"
          >
            In use
          </span>
        )}
      </div>
    </li>
  );
}
