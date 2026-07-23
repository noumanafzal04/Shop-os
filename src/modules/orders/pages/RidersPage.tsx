import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError } from "../../../common/types/api";
import { useRiders, useRiderMutations } from "../hooks/useOrders";

/**
 * The shop's own delivery riders (Model A). Assign them to delivery orders on
 * the Online Orders screen; the customer sees the rider's name while tracking.
 */
export default function RidersPage() {
  const riders = useRiders();
  const { create, update, remove } = useRiderMutations();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Action failed.");

  const add = () => {
    if (!name.trim()) return;
    setError(null);
    create.mutate(
      { name: name.trim(), phone: phone.trim() || undefined },
      { onSuccess: () => { setName(""); setPhone(""); }, onError },
    );
  };

  const rows = riders.data ?? [];

  return (
    <>
      <PageMeta title="Riders | ShopOS" description="Your delivery riders" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Delivery Riders</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Your own riders for delivery orders. Assign them on the Online Orders screen — the customer sees the rider's name while tracking.
        </p>
      </div>

      {error && <div className="mb-4"><Alert variant="error" title="Blocked" message={error} /></div>}

      {/* Add a rider */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <Label>Rider name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ahmed" />
          </div>
          <div>
            <Label>Phone (optional)</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92…" />
          </div>
          <Button onClick={add} disabled={create.isPending || !name.trim()}>
            {create.isPending ? "Adding…" : "+ Add rider"}
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        {riders.isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            No riders yet — add your first rider above.
          </p>
        ) : (
          <table className="w-full text-left text-theme-sm">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-5 py-3 font-medium">Rider</th>
                <th className="px-5 py-3 font-medium">Phone</th>
                <th className="px-5 py-3 font-medium">On delivery</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-5 py-3 font-medium text-gray-800 dark:text-white/90">{r.name}</td>
                  <td className="px-5 py-3">{r.phone ?? "—"}</td>
                  <td className="px-5 py-3">{r.active_deliveries ? `${r.active_deliveries} active` : "—"}</td>
                  <td className="px-5 py-3">
                    <Badge color={r.is_active ? "success" : "light"}>{r.is_active ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      className="mr-3 text-theme-xs text-brand-500 hover:text-brand-600"
                      onClick={() => { setError(null); update.mutate({ id: r.id, is_active: !r.is_active }, { onError }); }}
                    >
                      {r.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      className="text-theme-xs text-error-500 hover:text-error-600"
                      onClick={() => { if (confirm(`Remove ${r.name}?`)) { setError(null); remove.mutate(r.id, { onError }); } }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
