import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import TextArea from "../../../components/form/input/TextArea";
import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { ApiError } from "../../../common/types/api";
import { catalogService } from "../../catalog/services/catalogService";
import { vehiclesService } from "../../vehicles/services/vehiclesService";
import { documentService } from "../../documents/services/documentService";
import { boardWords } from "../words";
import { usePrimaryBusinessType } from "../../../common/tenant/businessType";

/**
 * A car arriving, in the thirty seconds somebody has while holding its keys.
 *
 * ── What this form refuses to ask for ───────────────────────────────────
 *
 * Not the parts. Not the labour. Not a price. Nobody knows any of that when a
 * car comes in — that is the entire reason a job card exists rather than a
 * quotation. Lines go on over the following hours from the document itself.
 *
 * What it does ask for is the plate and the complaint, because those two are
 * the job. A workshop that books a car in without recording what the customer
 * said is wrong has written down nothing worth keeping.
 *
 * ── The plate is found, not typed twice ─────────────────────────────────
 *
 * A returning car is already in the system with its history attached, and that
 * history is the reason a workshop keeps records at all. Typing the plate fresh
 * each visit would give the same car three records and answer "what did we do
 * last time" with silence.
 *
 * A plate nobody recognises is registered on the spot through the till's own
 * quick-create — the same path the POS uses, so a car booked in here and a car
 * added at the counter are one record.
 */

interface Props {
  onClose: () => void;
  onBooked: (number: string) => void;
}

export function BookInModal({ onClose, onBooked }: Props) {
  const toast = useToast();
  // A dry cleaner has no registration plate. The rest of this form — what the
  // customer said is wrong, when it was promised, the opening line — is
  // identical for a car and for eight shirts.
  const words = boardWords(usePrimaryBusinessType());

  const [plate, setPlate] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [complaint, setComplaint] = useState("");
  const [odometer, setOdometer] = useState("");
  const [promised, setPromised] = useState("");

  // The opening line. A job card needs at least one — usually the labour the
  // shop already knows it will charge for, or the part it is about to order.
  const [itemSearch, setItemSearch] = useState("");
  const [item, setItem] = useState<{ id: string; name: string } | null>(null);

  const debouncedPlate = useDebouncedValue(plate, 250);
  const debouncedItem = useDebouncedValue(itemSearch, 250);

  const plates = useQuery({
    queryKey: ["workshop", "plates", debouncedPlate],
    queryFn: async () => (await vehiclesService.lookup(debouncedPlate)).data,
    enabled: debouncedPlate.trim().length >= 2 && vehicleId === null,
  });

  const items = useQuery({
    queryKey: ["workshop", "items", debouncedItem],
    queryFn: async () =>
      (await catalogService.products({ search: debouncedItem, per_page: 8 })).data,
    enabled: debouncedItem.trim().length >= 2 && item === null,
  });

  const book = useMutation({
    mutationFn: async () => {
      // A plate nobody recognises becomes a record first — the same
      // quick-create the till uses, so one car is one record wherever it was
      // first seen.
      let id = vehicleId;
      if (words.tracksVehicle && id === null && plate.trim() !== "") {
        id = (await vehiclesService.quickCreate({ registration: plate.trim().toUpperCase() })).data.id;
      }

      return documentService.create({
        kind: "job_card",
        vehicle_id: words.tracksVehicle ? (id ?? undefined) : undefined,
        odometer_in: words.tracksVehicle && odometer.trim() !== "" ? Number(odometer) : undefined,
        complaint: complaint.trim() || undefined,
        promised_at: promised || undefined,
        customer_name: customer.trim() || undefined,
        customer_phone: phone.trim() || undefined,
        items: [{ product_id: item!.id, quantity: 1 }],
      });
    },
    onSuccess: ({ data }) => onBooked(data.number),
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? (e.firstFieldError() ?? e.message)
          : "That car could not be booked in.",
      ),
  });

  // A plate is required where the plate IS the job. Elsewhere the customer's
  // name and the instructions are what identify the work.
  const ready = (!words.tracksVehicle || plate.trim() !== "") && item !== null;

  return (
    <Modal isOpen onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">{words.takeIn}</h3>
      <p className="mb-4 text-theme-xs text-gray-500 dark:text-gray-400">
        Parts and labour go on as you work. Nothing here is a price.
      </p>

      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        {words.tracksVehicle && (
        <div>
          <Label>Registration</Label>
          <Input
            value={plate}
            placeholder="LEA-4291"
            onChange={(e) => {
              setPlate(e.target.value.toUpperCase());
              setVehicleId(null);
            }}
          />

          {/* A returning car keeps its history. Picking the existing record is
              what makes "what did we do last time" answerable. */}
          {(plates.data ?? []).length > 0 && vehicleId === null && (
            <div className="mt-1 space-y-1">
              {(plates.data ?? []).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setVehicleId(v.id);
                    setPlate(v.registration);
                    // The car remembers whose it is; the form should not ask again.
                    if (v.customer?.name) setCustomer(v.customer.name);
                    if (v.customer?.phone) setPhone(v.customer.phone);
                  }}
                  className="block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-left text-theme-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/[0.03]"
                >
                  <span className="font-medium text-gray-700 dark:text-gray-200">{v.registration}</span>
                  <span className="text-gray-400">
                    {" "}
                    {[v.make, v.model].filter(Boolean).join(" ")}
                    {v.customer?.name ? ` · ${v.customer.name}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}

          {vehicleId !== null && (
            <p className="mt-1 text-theme-xs text-success-600 dark:text-success-500">
              Known car — its history will be here.
            </p>
          )}
          {vehicleId === null && plate.trim() !== "" && (plates.data ?? []).length === 0 && (
            <p className="mt-1 text-theme-xs text-gray-400">
              New plate. It will be registered when you book the car in.
            </p>
          )}
        </div>
        )}

        <div>
          <Label>What is wrong, in the customer&rsquo;s words</Label>
          <TextArea
            rows={2}
            value={complaint}
            onChange={(v) => setComplaint(v)}
            placeholder={words.tracksVehicle ? "Noise from front left when braking" : "8 shirts, starch on collars"}
          />
          <p className="mt-1 text-theme-xs text-gray-400">
            The first thing whoever does the work reads. Write what they said, not what you think it
            is.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Customer</Label>
            <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {words.tracksVehicle && (
            <div>
              <Label>Odometer coming in</Label>
              <Input value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="Optional" />
            </div>
          )}
          <div>
            <Label>Promised back</Label>
            <Input type="datetime-local" value={promised} onChange={(e) => setPromised(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>First item</Label>
          {item === null ? (
            <>
              <Input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search a part or a labour item"
              />
              {(items.data ?? []).length > 0 && (
                <div className="mt-1 space-y-1">
                  {(items.data ?? []).slice(0, 6).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setItem({ id: p.id, name: p.name })}
                      className="block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-left text-theme-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/[0.03]"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-theme-sm dark:border-gray-700">
              <span className="text-gray-700 dark:text-gray-200">{item.name}</span>
              <button
                type="button"
                onClick={() => setItem(null)}
                className="text-theme-xs text-gray-400 hover:text-error-500"
              >
                Change
              </button>
            </div>
          )}
          <p className="mt-1 text-theme-xs text-gray-400">
            Something to open the job with — the diagnostic hour, or the part you already know it
            needs. Everything else goes on as you work.
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!ready || book.isPending} onClick={() => book.mutate()}>
          {book.isPending ? "Booking in…" : "Book in"}
        </Button>
      </div>
    </Modal>
  );
}
