import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError } from "../../../common/types/api";
import { useRiders, useRiderMutations } from "../hooks/useOrders";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import Pager from "../../../components/ui/pager";

/**
 * The shop's own delivery riders (Model A). Assign them to delivery orders on
 * the Online Orders screen; the customer sees the rider's name while tracking.
 */
export default function RidersPage() {
  const confirm = useConfirm();
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

  const all = riders.data ?? [];

  /**
   * PAGED HERE, NOT BY THE SERVER — and that is deliberate, not an oversight.
   *
   * `GET /riders` ends in `->get()`: it returns every rider this shop has, so
   * unlike the four lists the shared Pager was written for, NOTHING was ever
   * hidden on a page two that could not be reached. What was wrong is smaller
   * and still worth fixing: a shop with sixty riders got sixty rows in one
   * scroll, on a screen where every other list stops at twenty.
   *
   * Client-side keeps the API's shape exactly as it is. Moving the paging to
   * the server would change a flat array into an envelope, and this endpoint
   * is the shop's list of people — not somewhere to take that risk for a
   * cosmetic win.
   */
  const PER_PAGE = 20;
  const [page, setPage] = useState(1);
  const lastPage = Math.max(1, Math.ceil(all.length / PER_PAGE));
  // A rider deleted off the end of the last page must not strand the view on a
  // page that no longer exists — the screen would go blank with no way back.
  const current = Math.min(page, lastPage);
  const rows = all.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const pagination = { current_page: current, per_page: PER_PAGE, total: all.length, last_page: lastPage };

  return (
    <>
      <PageMeta title="Riders | CartZe" description="Your delivery riders" />

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
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        {riders.isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            No riders yet — add your first rider above.
          </p>
        ) : (
          <table className="w-full min-w-[38rem] text-left text-theme-sm">
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
                      className={ROW_ACTION}
                      onClick={() => { setError(null); update.mutate({ id: r.id, is_active: !r.is_active }, { onError }); }}
                    >
                      {r.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      className={ROW_ACTION_DANGER}
                      onClick={async () => {
                        if (await confirm({ title: `Remove ${r.name}?`, message: "Deliveries already assigned keep their record.", confirmLabel: "Remove", tone: "danger" })) { setError(null); remove.mutate(r.id, { onError }); }
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager pagination={pagination} onPage={setPage} noun="riders" />
      </div>
    </>
  );
}
