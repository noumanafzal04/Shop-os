import { useState } from "react";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { useTaxGroups, useTaxGroupMutations } from "../hooks/useTaxGroups";
import type { TaxGroup } from "../services/taxGroupsService";

/**
 * Manage reusable tax groups — named rates a product can point at instead of a
 * raw percent. Editing a group's rate re-rates every product on it. Rendered
 * inside Settings → Tax.
 */
export default function TaxGroupsManager() {
  const { data: groups, isLoading } = useTaxGroups();
  const { create, update, remove } = useTaxGroupMutations();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<{ id?: string; name: string; rate: string }>({ name: "", rate: "" });

  const save = () => {
    if (!draft.name.trim() || draft.rate === "") return;
    const payload = { name: draft.name.trim(), rate: Number(draft.rate) };
    const done = { onSuccess: () => { toast.success("Tax group saved"); setDraft({ name: "", rate: "" }); } };
    if (draft.id) update.mutate({ id: draft.id, ...payload }, done);
    else create.mutate(payload, done);
  };

  const del = async (g: TaxGroup) => {
    if (await confirm({ title: `Remove "${g.name}"?`, message: "Products on it fall back to their own rate or the shop default.", tone: "danger", confirmLabel: "Remove" })) {
      remove.mutate(g.id, { onSuccess: () => toast.success("Tax group removed") });
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">Tax groups</h3>
      <p className="mb-4 mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">Named rates a product can use (e.g. GST 17%). Change the rate once and every product on it re-rates.</p>

      <div className="mb-4 space-y-1.5">
        {isLoading ? (
          <p className="text-theme-sm text-gray-400">Loading…</p>
        ) : (groups ?? []).length === 0 ? (
          <p className="text-theme-sm text-gray-400">No tax groups yet.</p>
        ) : (groups ?? []).map((g) => (
          <div key={g.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 dark:border-gray-800">
            <div>
              <span className="font-medium text-gray-800 dark:text-white/90">{g.name}</span>
              <span className="ml-2 text-theme-xs text-gray-400">{Number(g.rate)}%{g.products_count != null ? ` · ${g.products_count} product(s)` : ""}</span>
            </div>
            <div className="flex gap-3">
              <button className="text-theme-xs font-medium text-brand-500 hover:text-brand-600" onClick={() => setDraft({ id: g.id, name: g.name, rate: String(g.rate) })}>Edit</button>
              <button className="text-theme-xs font-medium text-error-500 hover:text-error-600" onClick={() => del(g)}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 p-3 dark:border-gray-800">
        <div className="flex-1 min-w-[10rem]">
          <label className="mb-1 block text-theme-xs font-medium uppercase text-gray-400">{draft.id ? "Edit group" : "New group"}</label>
          <Input placeholder="Name (e.g. GST 17%)" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-theme-xs font-medium uppercase text-gray-400">Rate %</label>
          <Input type="number" min="0" max="100" placeholder="17" value={draft.rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} />
        </div>
        <Button size="sm" onClick={save} disabled={!draft.name.trim() || draft.rate === "" || create.isPending || update.isPending}>{draft.id ? "Save" : "Add"}</Button>
        {draft.id && <Button size="sm" variant="outline" onClick={() => setDraft({ name: "", rate: "" })}>Cancel</Button>}
      </div>
    </div>
  );
}
