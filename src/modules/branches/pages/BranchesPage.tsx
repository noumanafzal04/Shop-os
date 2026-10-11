import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Checkbox from "../../../components/form/input/Checkbox";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useAuthStore } from "../../../stores/authStore";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches, useBranchMutations } from "../hooks/useBranches";
import type { Branch, BranchInput, PlaceGoing } from "../services/branchService";
import { DeletePlaceDialog } from "../components/DeletePlaceDialog";
import { allowance, byKind, isWarehouse, kindWord, type Allowance, type PlaceKind } from "../places";

/**
 * Where the business sells, and where it keeps stock.
 *
 * Two lists, because they are two different things counted on two different
 * allowances. A BRANCH is a shop: a counter, a till, a day to close. A
 * WAREHOUSE holds stock and sells nothing — deliveries are received into it
 * and stock is sent on from it to a branch.
 *
 * It used to be one list of "branches", so a godown cost a branch on the
 * plan and a single shop could not have one. Reachable now by any business
 * that may have a second place of either kind.
 */
export default function BranchesPage() {
  const settings = useShopSettings();
  const branches = useBranches();
  const { create, update, remove } = useBranchMutations();
  // "Fill online orders from here" is a question only a shop that takes
  // online orders has.
  const sellsOnline = !!useAuthStore((s) => s.user?.tenant?.features?.marketplace);

  const modal = useModal();
  const toast = useToast();

  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchInput>({ name: "", kind: "shop" });

  const { shops, warehouses } = byKind(branches.data ?? []);
  const branchRoom = allowance(shops.length, settings.data?.max_branches);
  const warehouseRoom = allowance(warehouses.length, settings.data?.max_warehouses);
  const kind: PlaceKind = form.kind ?? "shop";

  const openCreate = (as: PlaceKind) => {
    setEditing(null);
    setForm({ name: "", kind: as, fills_orders: false });
    modal.openModal();
  };
  const openEdit = (b: Branch) => {
    setEditing(b);
    setForm({
      name: b.name, kind: b.kind, fills_orders: b.fills_orders, takes_deliveries: !!b.takes_deliveries,
      code: b.code ?? "", address: b.address ?? "", phone: b.phone ?? "", is_active: b.is_active,
    });
    modal.openModal();
  };

  const fieldErrors = (editing ? update.error : create.error) instanceof ApiError
    ? ((editing ? update.error : create.error) as ApiError).errors : {};
  const err = (k: string) => fieldErrors[k]?.[0];

  const save = () => {
    const word = kindWord(kind);
    const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : `Couldn't save the ${word}.`);
    const onSuccess = () => {
      toast.success(`${word === "warehouse" ? "Warehouse" : "Branch"} ${editing ? "updated" : "added"}`);
      modal.closeModal();
    };
    if (editing) {
      update.mutate({ id: editing.id, ...form }, { onSuccess, onError });
    } else {
      create.mutate(form, { onSuccess, onError });
    }
  };

  // Deleting asks first what is in the place, and then what becomes of it:
  // see DeletePlaceDialog.
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const confirmDelete = (going: PlaceGoing) => {
    if (!deleting) return;
    const name = deleting.name;
    remove.mutate({ id: deleting.id, ...going }, {
      onSuccess: () => { toast.success(`Deleted "${name}"`); setDeleting(null); },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Delete failed."),
    });
  };

  const card = (b: Branch) => (
    <div key={b.id} data-testid="place-card" data-kind={b.kind} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-medium text-gray-800 dark:text-white/90">{b.name}</h3>
        <span className="flex flex-wrap justify-end gap-1">
          {b.is_default && <Badge size="sm" color="info">Main</Badge>}
          {!b.is_active && <Badge size="sm" color="warning">Closed</Badge>}
          {isWarehouse(b) && sellsOnline && b.fills_orders && <Badge size="sm" color="success">Ships online orders</Badge>}
          {b.takes_deliveries && <Badge size="sm" color="primary">Deliveries come here</Badge>}
        </span>
      </div>
      <p className="text-theme-sm text-gray-500 dark:text-gray-400">{b.address || "No address set"}</p>
      {b.phone && <p className="text-theme-xs text-gray-400">{b.phone}</p>}
      <div className="mt-4 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => openEdit(b)}>Edit</Button>
        {/* A Button rather than the row-action pill, because the Edit
            beside it is a Button. A pair where only one half is a
            control reads as a control and a label. */}
        {!b.is_default && (
          <Button size="sm" variant="danger" onClick={() => setDeleting(b)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );

  const section = (title: string, about: string, list: Branch[], room: Allowance, as: PlaceKind, none: string) => (
    <section className="mb-8" data-testid={`places-${as}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">{title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {about} · <span data-testid={`places-${as}-used`}>{room.says}</span>
          </p>
        </div>
        <Button size="sm" onClick={() => openCreate(as)} disabled={!room.room}>
          + Add {kindWord(as)}
        </Button>
      </div>

      {!room.room && settings.data && (
        <div className="mb-4">
          <Alert
            variant="info"
            title={`${as === "warehouse" ? "Warehouse" : "Branch"} limit reached`}
            message={
              room.limit === 0
                ? `Your plan does not include a ${kindWord(as)}. Ask support to add one.`
                : `Your plan allows ${room.limit} ${kindWord(as)}${room.limit === 1 ? "" : as === "warehouse" ? "s" : "es"}. Ask support to raise this limit to add more.`
            }
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {branches.isLoading ? (
          Array.from({ length: as === "shop" ? 2 : 1 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          ))
        ) : list.length === 0 ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <ListEmpty from={branches} what={as === "warehouse" ? "the warehouses" : "the branches"}>
              <p className="rounded-2xl border border-dashed border-gray-200 px-5 py-8 text-center text-sm text-gray-400 dark:border-gray-800">{none}</p>
            </ListEmpty>
          </div>
        ) : (
          list.map(card)
        )}
      </div>
    </section>
  );

  return (
    <>
      <PageMeta title="Branches & warehouses" description="Where the business sells, and where it keeps stock" />

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Branches &amp; warehouses</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Where the business sells, and where it keeps stock.</p>
      </div>

      {section("Branches", "Shops with a counter and a till", shops, branchRoom, "shop", "No branches yet.")}
      {/* Drawn only for a business that keeps stock: with nothing to hold, a
          warehouse section would be a heading over a limit of nought. */}
      {(warehouses.length > 0 || warehouseRoom.limit !== 0) &&
        section(
          "Warehouses",
          "Hold stock and sell nothing",
          warehouses,
          warehouseRoom,
          "warehouse",
          "No warehouse yet. Add one for the godown or store room: deliveries can be received into it, and stock sent on to a branch as the shelf empties.",
        )}

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? "Edit" : "Add"} {kindWord(kind)}
        </h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          {kind === "warehouse"
            ? "A warehouse holds stock and has no till. Nothing is sold across a counter there."
            : "A branch is a shop: it has its own stock, its own till and its own day."}
        </p>
        <div className="space-y-4">
          <div>
            <Label htmlFor="place-name">Name <span className="text-error-500">*</span></Label>
            <Input id="place-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={kind === "warehouse" ? "e.g. Godown" : "e.g. Gulberg"} />
            {err("name") && <p className="mt-1 text-theme-xs text-error-500">{err("name")}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="place-code">Short code</Label>
              <Input id="place-code" value={form.code ?? ""} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder={kind === "warehouse" ? "WH" : "GLB"} />
            </div>
            <div>
              <Label htmlFor="place-phone">Phone</Label>
              <Input id="place-phone" value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="042…" />
            </div>
          </div>
          <div>
            <Label htmlFor="place-address">Address</Label>
            <Input id="place-address" value={form.address ?? ""} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Street, area" />
          </div>
          {kind === "warehouse" && sellsOnline && (
            <div>
              <Checkbox
                id="place-ships"
                label="Fill online orders from this warehouse"
                checked={!!form.fills_orders}
                onChange={(on) => setForm((f) => ({ ...f, fills_orders: on }))}
              />
              <p className="mt-1 pl-8 text-theme-xs text-gray-400">
                On for a business that packs its online orders at the warehouse. Off, orders are only ever filled from a branch.
              </p>
            </div>
          )}
          {/* WHERE THE SUPPLIER'S VAN COMES. Unmarked everywhere, each order
              is addressed to whoever raises it — the supplier delivers to the
              branch. Marked on one place — a warehouse, usually — every new
              purchase order starts addressed to it. */}
          {form.is_active !== false && (
            <div>
              <Checkbox
                id="place-takes-deliveries"
                label="Deliveries come here"
                checked={!!form.takes_deliveries}
                onChange={(on) => setForm((f) => ({ ...f, takes_deliveries: on }))}
              />
              <p className="mt-1 pl-8 text-theme-xs text-gray-400">
                New purchase orders start addressed to this place. Only one place can be marked; leave every place unmarked if suppliers deliver to whichever branch ordered.
              </p>
            </div>
          )}
          {/* A place can change kind — a shop that stopped trading becomes the
              store room. Main cannot: it is where the business sells. */}
          {editing && !editing.is_default && (
            <div>
              <Checkbox
                id="place-is-warehouse"
                label="This place is a warehouse"
                checked={kind === "warehouse"}
                onChange={(on) => setForm((f) => ({ ...f, kind: on ? "warehouse" : "shop" }))}
              />
              {err("kind") && <p className="mt-1 text-theme-xs text-error-500">{err("kind")}</p>}
            </div>
          )}
          {/* CLOSED is the other way out, and the gentler one: the place stays
              named on its old records and is left out of every list to choose
              from. Held to the same conditions as deleting — it must be empty. */}
          {editing && !editing.is_default && (
            <div>
              <Checkbox
                id="place-closed"
                label="This place is closed"
                checked={form.is_active === false}
                onChange={(on) => setForm((f) => ({ ...f, is_active: !on }))}
              />
              <p className="mt-1 pl-8 text-theme-xs text-gray-400">
                Closed, it is no longer offered anywhere — but its name stays on what happened there. It must be empty first, like deleting.
              </p>
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={create.isPending || update.isPending || !form.name.trim()}>
            {create.isPending || update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>

      <DeletePlaceDialog
        place={deleting}
        places={branches.data ?? []}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onDelete={confirmDelete}
      />
    </>
  );
}
