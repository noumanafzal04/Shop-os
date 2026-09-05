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
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useRiderStatement } from "../hooks/useOrders";
import { useMoney } from "../../shop/hooks/useShop";

/**
 * The shop's own delivery riders (Model A). Assign them to delivery orders on
 * the Online Orders screen; the customer sees the rider's name while tracking.
 */
export default function RidersPage() {
  const confirm = useConfirm();
  // The shop's own currency symbol, not a hardcoded "Rs" — one shop's setting
  // is not every shop's.
  const money = useMoney();
  const riders = useRiders();
  const { create, update, remove, invite, settle } = useRiderMutations();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which rider's cash is being counted. Null = the dialog is shut, and the
  // statement query is disabled — a shop with forty riders must not ask for
  // forty statements to draw a list.
  const [settling, setSettling] = useState<string | null>(null);
  const [paid, setPaid] = useState("");
  const [note, setNote] = useState("");
  const statement = useRiderStatement(settling);

  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Action failed.");

  const add = () => {
    if (!name.trim()) return;
    setError(null);
    create.mutate(
      { name: name.trim(), phone: phone.trim() || undefined },
      { onSuccess: () => { setName(""); setPhone(""); }, onError },
    );
  };

  const addByCode = () => {
    if (!code.trim()) return;
    setError(null);
    invite.mutate(code.trim().toUpperCase(), { onSuccess: () => setCode(""), onError });
  };

  const doSettle = () => {
    if (settling == null) return;
    setError(null);
    settle.mutate(
      {
        id: settling,
        // Blank means "all of it" — the server falls back to the counted cash.
        // Sending 0 for an empty box would record that the shop took nothing.
        amount_paid: paid.trim() === "" ? undefined : Number(paid),
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          setSettling(null);
          setPaid("");
          setNote("");
        },
        onError,
      },
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

      {/*
        TWO WAYS TO ADD SOMEBODY, because there are two kinds of rider and a
        shop has both.

        A NAME is a contact card: your cousin with a motorbike, who has no app
        and never will. You assign them an order and you move it along yourself.
        That is how every rider in this product worked until now, and it keeps
        working exactly as it did.

        A RIDER ID belongs to somebody holding the app. They see your
        deliveries on their phone, collect them, and close them at the door
        with the customer's code. By code and not by name on purpose: a shop
        able to search the platform's riders by name would be a searchable
        directory of strangers' phone numbers.
      */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-1 text-sm font-semibold text-gray-800 dark:text-white/90">Add your own rider</h3>
          <p className="mb-3 text-theme-xs text-gray-500 dark:text-gray-400">
            A name and a number. You assign their deliveries and mark them delivered yourself.
          </p>
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
              {create.isPending ? "Adding…" : "+ Add"}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-1 text-sm font-semibold text-gray-800 dark:text-white/90">Add a rider with the app</h3>
          <p className="mb-3 text-theme-xs text-gray-500 dark:text-gray-400">
            Ask them for their rider id — it is on their own Rider screen, like RDR-000123.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label>Rider id</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="RDR-000123"
              />
            </div>
            <Button onClick={addByCode} disabled={invite.isPending || !code.trim()}>
              {invite.isPending ? "Adding…" : "+ Add"}
            </Button>
          </div>
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
                <th className="px-5 py-3 font-medium">Cash held</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-5 py-3 font-medium text-gray-800 dark:text-white/90">
                    {r.name}
                    {r.has_app && (
                      <span className="ml-2 text-theme-xs font-normal text-gray-400">{r.rider_code}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">{r.phone ?? "—"}</td>
                  <td className="px-5 py-3">{r.active_deliveries ? `${r.active_deliveries} active` : "—"}</td>
                  <td className="px-5 py-3">
                    {/*
                      The shop's own money, in somebody else's pocket. Shown as
                      a plain dash at zero rather than "Rs 0", so a row with
                      cash outstanding is the only row that reads as a number.
                    */}
                    {(r.cash_in_hand ?? 0) > 0 ? (
                      <span className="font-medium text-warning-600 dark:text-warning-400">
                        {money(r.cash_in_hand ?? 0)}
                        <span className="ml-1 text-theme-xs font-normal text-gray-400">
                          ({r.unsettled_orders})
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge color={r.is_active ? "success" : "light"}>{r.is_active ? "Active" : "Inactive"}</Badge>
                      {r.has_app && (
                        <Badge color={r.is_online ? "success" : "light"}>
                          {r.is_online ? "Online" : "Has app"}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {(r.cash_in_hand ?? 0) > 0 && (
                      <button
                        className={ROW_ACTION}
                        onClick={() => {
                          setError(null);
                          setSettling(r.id);
                        }}
                      >
                        Settle cash
                      </button>
                    )}
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

      {/*
        TAKING THE CASH BACK.

        Every delivered, unsettled cash order for this rider, listed so the
        count can be checked against what is actually on the table. `Amount
        paid` is left blank for the ordinary case — it exists for the evening
        where the shop rounds, or holds something back, and the record has to
        say what really changed hands rather than what should have.
      */}
      <Modal isOpen={settling !== null} onClose={() => setSettling(null)} className="max-w-lg">
        <ModalForm
          title={`Settle with ${statement.data?.rider.name ?? "rider"}`}
          description="Everything they are holding for this shop, in one entry."
          footer={
            <>
              <Button variant="outline" onClick={() => setSettling(null)}>
                Cancel
              </Button>
              <Button onClick={doSettle} disabled={settle.isPending || statement.isLoading}>
                {settle.isPending ? "Recording…" : "Cash received"}
              </Button>
            </>
          }
        >
          {statement.isLoading ? (
            <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              <div className="rounded-xl border border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Cash collected</span>
                  <span className="text-lg font-semibold text-gray-800 dark:text-white/90">
                    {money(statement.data?.cash_in_hand ?? 0)}
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                  {(statement.data?.orders ?? []).map((o) => (
                    <div key={o.id} className="flex items-center justify-between px-4 py-2 text-theme-sm">
                      <span className="text-gray-700 dark:text-gray-300">{o.order_number}</span>
                      <span className="text-gray-500 dark:text-gray-400">{money(o.total)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                Of that, {money(statement.data?.rider_earned ?? 0)} is what the rider earned in
                delivery fees. This entry records the cash — it does not pay them.
              </p>

              <div>
                <Label>Amount actually paid (optional)</Label>
                <Input
                  type="number"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  placeholder={String(statement.data?.cash_in_hand ?? 0)}
                />
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Evening count" />
              </div>
            </>
          )}
        </ModalForm>
      </Modal>
    </>
  );
}
