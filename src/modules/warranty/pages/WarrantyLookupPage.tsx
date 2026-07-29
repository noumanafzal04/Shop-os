import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import { warrantyService, type WarrantyRecord } from "../services/warrantyService";
import { ApiError } from "../../../common/types/api";

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

export default function WarrantyLookupPage() {
  const [serial, setSerial] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [record, setRecord] = useState<WarrantyRecord | null>(null);

  const lookup = useMutation({
    mutationFn: (s: string) => warrantyService.lookup(s),
    onSuccess: ({ data }) => {
      setRecord(data);
      setNotFound(false);
    },
    onError: (e) => {
      setRecord(null);
      // A clean "no such serial" is the common case — everything else surfaces
      // the server message.
      setNotFound(e instanceof ApiError && e.errorCode === "SERIAL_NOT_FOUND");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = serial.trim();
    if (s) lookup.mutate(s);
  };

  return (
    <>
      <PageMeta title="Warranty lookup" description="Look up a serial / IMEI" />
      <div className="mx-auto max-w-2xl">
        <div className="mb-5">
          <h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Warranty desk</h1>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            Enter the serial / IMEI on the device to see when it was sold and whether it's still under warranty.
          </p>
        </div>

        <form onSubmit={submit} className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Serial / IMEI</label>
            <Input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="Scan or type the serial / IMEI"
            />
          </div>
          <Button disabled={lookup.isPending || !serial.trim()}>
            {lookup.isPending ? "Looking up…" : "Look up"}
          </Button>
        </form>

        {notFound && (
          <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 p-6 text-center text-theme-sm text-gray-500 dark:border-gray-800 dark:bg-white/5 dark:text-gray-400">
            No sale found for that serial / IMEI.
          </div>
        )}

        {record && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800">
            {/* Warranty banner — the counter's at-a-glance answer. */}
            <div
              className={`flex items-center justify-between px-6 py-4 ${
                record.under_warranty
                  ? "bg-success-50 dark:bg-success-500/10"
                  : "bg-error-50 dark:bg-error-500/10"
              }`}
            >
              <div>
                <div className={`text-lg font-semibold ${record.under_warranty ? "text-success-700 dark:text-success-400" : "text-error-700 dark:text-error-400"}`}>
                  {record.under_warranty ? "Under warranty" : "Warranty expired"}
                </div>
                <div className="text-theme-sm text-gray-500 dark:text-gray-400">
                  {record.under_warranty
                    ? `${record.days_left} day${record.days_left === 1 ? "" : "s"} left`
                    : record.warranty_expires_at
                      ? `Expired ${fmtDate(record.warranty_expires_at)}`
                      : "No warranty on this item"}
                </div>
              </div>
              <span className="rounded-lg bg-white/70 px-2.5 py-1 font-mono text-theme-sm text-gray-700 dark:bg-black/20 dark:text-gray-200">
                {record.serial}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-6 sm:grid-cols-2">
              <Field label="Product" value={record.product_name} />
              <Field label="Sold on" value={fmtDate(record.sold_at)} />
              <Field label="Warranty" value={record.warranty_months != null ? `${record.warranty_months} months` : "—"} />
              <Field label="Expires" value={fmtDate(record.warranty_expires_at)} />
              <Field label="Invoice" value={record.sale?.invoice_number ?? "—"} />
              <Field label="Sale status" value={record.sale?.status ?? "—"} />
              <Field label="Customer" value={record.sale?.customer_name || record.sale?.customer_phone || "Walk-in"} />
            </dl>
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-theme-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-theme-sm font-medium text-gray-800 dark:text-white/90">{value}</dd>
    </div>
  );
}
