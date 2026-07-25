import { useState } from "react";
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

export default function FloorPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const tables = useTables();
  const { openTicket, createTable, deleteTable } = useDineInMutations();

  const modal = useModal();
  const [seating, setSeating] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState("2");

  const [editMode, setEditMode] = useState(false);
  const tableModal = useModal();
  const [tableName, setTableName] = useState("");
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
    setTableSeats("4");
    createTable.reset();
    tableModal.openModal();
  };

  const confirmAddTable = () => {
    if (createTable.isPending || !tableName.trim()) return;
    createTable.mutate(
      { name: tableName.trim(), seats: Number(tableSeats) || undefined },
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

  const rows = tables.data ?? [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageMeta title="Dine-in | ShopOS" description="Restaurant floor" />

      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/tenant")} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
            ← Dashboard
          </button>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">Dine-in Floor</h1>
        </div>
        <div className="flex items-center gap-2">
          {editMode && <Button size="sm" variant="outline" onClick={addTable}>+ Add table</Button>}
          <Button size="sm" variant="outline" onClick={() => setEditMode((v) => !v)}>
            {editMode ? "Done" : "Edit floor"}
          </Button>
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
            <p className="mt-1 text-sm text-gray-400">Add your first table to lay out the floor, or take a takeaway order.</p>
            <div className="mt-4"><Button size="sm" onClick={addTable}>+ Add table</Button></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {rows.map((t) => {
              const occupied = !!t.open_ticket;
              return (
                <div key={t.id} className="relative">
                  <button
                    onClick={() =>
                      editMode
                        ? undefined
                        : occupied
                          ? navigate(`/tenant/dine-in/tickets/${t.open_ticket!.id}`)
                          : openFor(t)
                    }
                    disabled={editMode}
                    className={`flex h-32 w-full flex-col items-center justify-center rounded-2xl border p-3 text-center transition-colors ${
                      occupied
                        ? "border-brand-500 bg-brand-500 text-white shadow-sm"
                        : "border-gray-200 bg-white text-gray-700 hover:border-brand-400 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-200"
                    } ${editMode ? "cursor-default" : ""}`}
                  >
                    <span className="text-lg font-bold">{t.name}</span>
                    {t.seats != null && (
                      <span className={`text-theme-xs ${occupied ? "text-white/80" : "text-gray-400"}`}>
                        {t.seats} seats
                      </span>
                    )}
                    {occupied ? (
                      <span className="mt-2 rounded-full bg-white/20 px-2 py-0.5 text-theme-xs font-medium">
                        Tab {t.open_ticket!.ticket_number}
                      </span>
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
                </div>
              );
            })}
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
    </div>
  );
}
