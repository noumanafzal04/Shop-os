import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { useTables, useDineInMutations } from "../hooks/useDineIn";
import type { DiningTable } from "../services/dineInService";
import { useMayWorkTable } from "../ownership";
import { useAuthStore } from "../../../stores/authStore";
import WaiterReportModal from "../components/WaiterReportModal";

/** A blank area is one section ("the floor"), not a section named "". */
const areaOf = (t: DiningTable): string | null => t.area?.trim() || null;

export default function FloorPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const tables = useTables();
  const { openTicket, createTable, deleteTable, reorderTables: reorder } = useDineInMutations();
  const reportModal = useModal();

  const mayWork = useMayWorkTable();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  // Reading the floor is floor work; laying it out is configuration. A waiter
  // holds neither of these, so the buttons that would only 403 are not shown.
  const canConfigure = hasPermission("settings.manage");
  const canSeeReports = hasPermission("reports.view");

  const modal = useModal();
  const [seating, setSeating] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState("2");

  const [editMode, setEditMode] = useState(false);
  const tableModal = useModal();
  const [tableName, setTableName] = useState("");
  const [tableArea, setTableArea] = useState("");
  const [tableSeats, setTableSeats] = useState("4");

  const openFor = (table: DiningTable | null) => {
    setSeating(table);
    setGuests("2");
    openTicket.reset();
    modal.openModal();
  };

  const confirmOpen = () => {
    if (openTicket.isPending) return;
    openTicket.mutate(
      {
        order_type: seating ? "dine_in" : "takeaway",
        dining_table_id: seating?.id ?? null,
        guest_count: Number(guests) || 1,
      },
      {
        onSuccess: (res) => {
          modal.closeModal();
          navigate(`/tenant/dine-in/tickets/${res.data.id}`);
        },
        onError: () => toast.error("Couldn't open the tab."),
      },
    );
  };

  const addTable = () => {
    setTableName("");
    setTableArea("");
    setTableSeats("4");
    createTable.reset();
    tableModal.openModal();
  };

  const confirmAddTable = () => {
    if (createTable.isPending || !tableName.trim()) return;
    createTable.mutate(
      {
        name: tableName.trim(),
        area: tableArea.trim() || undefined,
        seats: Number(tableSeats) || undefined,
      },
      {
        onSuccess: () => { tableModal.closeModal(); toast.success("Table added"); },
        onError: () => toast.error("Couldn't add the table."),
      },
    );
  };

  const removeTable = async (table: DiningTable) => {
    const ok = await confirm({ title: `Remove ${table.name}?`, confirmLabel: "Remove", tone: "danger" });
    if (!ok) return;
    deleteTable.mutate(table.id, {
      onSuccess: () => toast.success("Table removed"),
      onError: () => toast.error("Couldn't remove — it may have an open tab."),
    });
  };

  const rows = useMemo(() => tables.data ?? [], [tables.data]);

  /**
   * The floor, clustered into its sections. Groups appear in the order their
   * first table does, so the arrangement an owner set is what shows — this is
   * a grouping of the existing order, never a re-sort of it.
   */
  const groups = useMemo(() => {
    const out: Array<{ area: string | null; tables: DiningTable[] }> = [];
    for (const t of rows) {
      const area = areaOf(t);
      const existing = out.find((g) => g.area === area);
      if (existing) existing.tables.push(t);
      else out.push({ area, tables: [t] });
    }
    return out;
  }, [rows]);

  /** Display order — what the reorder endpoint is told, so the two agree. */
  const ordered = useMemo(() => groups.flatMap((g) => g.tables), [groups]);
  const hasSections = groups.some((g) => g.area !== null);

  /**
   * A move stays inside its section. Shuffling a table past the boundary would
   * put a rooftop table in the hall, which is a rename, not a reorder.
   */
  const swapTarget = (id: string, delta: number): number => {
    const at = ordered.findIndex((r) => r.id === id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= ordered.length) return -1;
    return areaOf(ordered[at]) === areaOf(ordered[to]) ? to : -1;
  };

  /**
   * Shuffle one table along by a place. The server takes the whole order and
   * uses each id's index as its position, so the list is sent entire — a
   * per-table "sort_order" nudge would leave two tables sharing a slot the
   * first time one was deleted.
   */
  const moveTable = (id: string, delta: number) => {
    if (reorder.isPending) return;
    const at = ordered.findIndex((r) => r.id === id);
    const to = swapTarget(id, delta);
    if (to < 0) return;
    const order = ordered.map((r) => r.id);
    [order[at], order[to]] = [order[to], order[at]];
    reorder.mutate(order, { onError: () => toast.error("Couldn't move that table.") });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageMeta title="Dine-in | CartZe" description="Restaurant floor" />

      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/tenant")} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
            ← Dashboard
          </button>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">Dine-in Floor</h1>
        </div>
        <div className="flex items-center gap-2">
          {editMode && <Button size="sm" variant="outline" onClick={addTable}>+ Add table</Button>}
          {!editMode && canSeeReports && (
            <Button size="sm" variant="outline" onClick={reportModal.openModal}>
              Waiters
            </Button>
          )}
          {canConfigure && (
            <Button size="sm" variant="outline" onClick={() => setEditMode((v) => !v)}>
              {editMode ? "Done" : "Edit floor"}
            </Button>
          )}
          {!editMode && <Button size="sm" onClick={() => openFor(null)}>+ Takeaway</Button>}
        </div>
      </header>

      <div className="p-5">
        {tables.isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">No tables yet.</p>
            <p className="mt-1 text-sm text-gray-400">
              {canConfigure
                ? "Add your first table to lay out the floor, or take a takeaway order."
                : "Nobody has laid out the floor yet. Ask the owner to add the tables."}
            </p>
            {canConfigure && <div className="mt-4"><Button size="sm" onClick={addTable}>+ Add table</Button></div>}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.area ?? "__floor"}>
                {/* Headings only once a floor actually has sections — a single
                    unnamed group titled "Floor" is a label saying nothing. */}
                {hasSections && (
                  <h2 className="mb-2 text-theme-xs font-semibold uppercase tracking-wider text-gray-400">
                    {group.area ?? "Floor"}
                  </h2>
                )}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {group.tables.map((t) => {
                    const tab = t.open_ticket;
                    const occupied = !!tab;
                    // Colour carries one meaning: is this table mine to work?
                    // Tapping still opens it either way — reading someone
                    // else's tab is allowed, changing it is not.
                    const mine = mayWork(tab?.waiter_id);
                    return (
                      <div key={t.id} className="relative">
                        <button
                          onClick={() =>
                            editMode ? undefined : tab ? navigate(`/tenant/dine-in/tickets/${tab.id}`) : openFor(t)
                          }
                          disabled={editMode}
                          className={`flex h-32 w-full flex-col items-center justify-center rounded-2xl border p-3 text-center transition-colors ${
                            occupied && mine
                              ? "border-brand-500 bg-brand-500 text-white shadow-sm"
                              : occupied
                                ? "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                : "border-gray-200 bg-white text-gray-700 hover:border-brand-400 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-200"
                          } ${editMode ? "cursor-default" : ""}`}
                        >
                          <span className="text-lg font-bold">{t.name}</span>
                          {t.seats != null && (
                            <span className={`text-theme-xs ${occupied && mine ? "text-white/80" : "text-gray-400"}`}>
                              {t.seats} seats
                            </span>
                          )}
                          {tab ? (
                            <>
                              <span
                                className={`mt-2 rounded-full px-2 py-0.5 text-theme-xs font-medium ${
                                  mine ? "bg-white/20" : "bg-gray-200 dark:bg-gray-700"
                                }`}
                              >
                                Tab {tab.ticket_number}
                              </span>
                              {tab.waiter && (
                                <span
                                  className={`mt-1 truncate text-theme-xs ${mine ? "text-white/70" : "text-gray-500 dark:text-gray-400"}`}
                                >
                                  {tab.waiter.name}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="mt-2 text-theme-xs text-success-600 dark:text-success-500">Free</span>
                          )}
                        </button>
                        {editMode && !occupied && (
                          <button
                            onClick={() => removeTable(t)}
                            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-error-500 text-sm text-white shadow hover:bg-error-600"
                            aria-label={`Remove ${t.name}`}
                          >
                            ×
                          </button>
                        )}
                        {/* Move, rather than drag. The floor is laid out on a tablet
                            propped by the till, and a drag target that small is a
                            table dropped in the wrong place — which on a busy floor
                            means a waiter walking to the wrong one. */}
                        {editMode && (
                          <div className="absolute inset-x-0 -bottom-3 flex justify-center gap-1">
                            <button
                              onClick={() => moveTable(t.id, -1)}
                              disabled={reorder.isPending || swapTarget(t.id, -1) < 0}
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                              aria-label={`Move ${t.name} earlier`}
                            >
                              ‹
                            </button>
                            <button
                              onClick={() => moveTable(t.id, 1)}
                              disabled={reorder.isPending || swapTarget(t.id, 1) < 0}
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                              aria-label={`Move ${t.name} later`}
                            >
                              ›
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          {seating ? `Open tab — ${seating.name}` : "New takeaway order"}
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {seating ? "Seat the guests and start their tab." : "Start a takeaway tab — no table."}
        </p>

        {seating && (
          <div className="mb-4">
            <Label>Guests</Label>
            <Input type="number" min="1" value={guests} onChange={(e) => setGuests(e.target.value)} />
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={confirmOpen} disabled={openTicket.isPending}>
            {openTicket.isPending ? "Opening…" : "Open tab"}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={tableModal.isOpen} onClose={tableModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Add table</h3>
        <div className="space-y-4">
          <div>
            <Label>Name <span className="text-error-500">*</span></Label>
            <Input value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="e.g. T1 or Patio 3" />
          </div>
          <div>
            <Label>Section <span className="font-normal text-gray-400">(optional)</span></Label>
            <Input
              value={tableArea}
              onChange={(e) => setTableArea(e.target.value)}
              placeholder="e.g. Garden, Rooftop, Hall"
              list="dine-in-areas"
            />
            {/* Existing sections offered back, so "Rooftop" and "rooftop" don't
                become two parts of the restaurant. */}
            <datalist id="dine-in-areas">
              {[...new Set(rows.map(areaOf).filter((a): a is string => a !== null))].map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <p className="mt-1 text-theme-xs text-gray-400">Groups the floor. It does not decide who may serve the table.</p>
          </div>
          <div>
            <Label>Seats</Label>
            <Input type="number" min="1" value={tableSeats} onChange={(e) => setTableSeats(e.target.value)} />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={tableModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={confirmAddTable} disabled={createTable.isPending || !tableName.trim()}>
            {createTable.isPending ? "Adding…" : "Add table"}
          </Button>
        </div>
      </Modal>

      <WaiterReportModal isOpen={reportModal.isOpen} onClose={reportModal.closeModal} />
    </div>
  );
}
