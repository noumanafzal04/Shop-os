import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../../../common/api/client";
import Badge from "../../../components/ui/badge/Badge";

/**
 * What the banks owe this shop.
 *
 * ── This screen IS the feature ──────────────────────────────────────────
 *
 * A bank card offer is not the shop's discount. HBL runs it, the customer pays
 * less, and HBL reimburses the shop afterwards. Everything at the till — the
 * dropdown, the quote, the reduced tender — is the easy half. This is the half
 * that turns a discount funded by nobody into an invoice somebody pays, and a
 * shop that never opens it has simply given the money away.
 *
 * ── Grouped per CAMPAIGN, not per bank ──────────────────────────────────
 *
 * A bank reimburses against a campaign. "HBL Ramadan" and "HBL Weekend Fuel"
 * are two claims to two desks, and one combined figure matches neither invoice.
 *
 * ── Rows with no card reference are counted AND named ───────────────────
 *
 * The last four digits are optional at the counter on purpose — a cashier with
 * a queue must never be blocked by a reference field. But a bank matches a
 * claim on them, so a sale without one may be harder to collect. Dropping those
 * rows would understate the claim; hiding them would overstate what is
 * collectable. They are counted, flagged, and the shop decides.
 */

interface ClaimLine {
  invoice_number: string | null;
  sold_at: string | null;
  total: number;
  discount: number;
  card_last4: string | null;
}

interface Claim {
  offer_id: string | null;
  offer: string | null;
  bank: string | null;
  sales: number;
  card_value: number;
  discount: number;
  unreferenced: number;
  lines: ClaimLine[];
}

interface BankClaimsReport {
  period: { from: string; to: string };
  totals: { sales: number; card_value: number; discount: number; unreferenced: number };
  claims: Claim[];
}

const money = (n: number) => `Rs ${Number(n).toLocaleString()}`;

const day = (iso: string | null) =>
  iso === null ? "—" : new Date(iso).toLocaleDateString();

export function BankClaimsTab({ range }: { range: { from: string; to: string } }) {
  const report = useQuery({
    queryKey: ["reports", "bank-claims", range.from, range.to],
    queryFn: async () =>
      (await apiGet<BankClaimsReport>("/reports/bank-claims", { params: range })).data,
  });

  if (report.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  }

  const data = report.data;
  const totals = data?.totals;

  if (!data || (totals?.sales ?? 0) === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
        <p className="text-gray-500 dark:text-gray-400">No bank-funded sales in this period.</p>
        <p className="mx-auto mt-1 max-w-md text-theme-xs text-gray-400">
          When a bank runs a deal on its own cards, pick the bank at the till and the amount it
          owes you appears here. Set the deals up under Customers → Bank offers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* What to invoice, in one line, because that is the question being asked. */}
      <div className="rounded-2xl border border-success-200 bg-success-50 p-4 dark:border-success-500/30 dark:bg-success-500/10">
        <p className="text-theme-xs font-semibold uppercase tracking-wide text-success-700 dark:text-success-400">
          The banks owe you
        </p>
        <p className="mt-1 text-3xl font-extrabold tabular-nums text-gray-900 dark:text-white">
          {money(totals!.discount)}
        </p>
        <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
          across {totals!.sales} {totals!.sales === 1 ? "sale" : "sales"} worth{" "}
          {money(totals!.card_value)}
        </p>

        {totals!.unreferenced > 0 && (
          <p className="mt-2 text-theme-xs text-warning-700 dark:text-warning-400">
            {totals!.unreferenced} of them have no card number recorded. Banks usually match a
            claim on the last 4 digits, so those may be harder to collect — ask cashiers to enter
            them.
          </p>
        )}
      </div>

      {data.claims.map((claim) => (
        <div
          key={claim.offer_id ?? claim.offer}
          className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-4 dark:border-gray-800">
            <div>
              <h3 className="font-semibold text-gray-800 dark:text-white/90">
                {claim.bank} · {claim.offer}
              </h3>
              <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                {claim.sales} {claim.sales === 1 ? "sale" : "sales"} · {money(claim.card_value)} on
                their cards
              </p>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">
                {money(claim.discount)}
              </p>
              {claim.unreferenced > 0 && (
                <Badge color="warning">{claim.unreferenced} without a card number</Badge>
              )}
            </div>
          </div>

          {/* Everything a claim form asks for, in the order it asks. */}
          <div className="overflow-x-auto">
            <table className="w-full text-theme-sm">
              <thead className="text-left text-theme-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Invoice</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Card</th>
                  <th className="px-4 py-2 text-right font-medium">Sale</th>
                  <th className="px-4 py-2 text-right font-medium">Owed</th>
                </tr>
              </thead>
              <tbody>
                {claim.lines.map((line) => (
                  <tr
                    key={line.invoice_number ?? `${line.sold_at}-${line.discount}`}
                    className="border-t border-gray-100 dark:border-gray-800"
                  >
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-200">
                      {line.invoice_number ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                      {day(line.sold_at)}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-gray-500 dark:text-gray-400">
                      {line.card_last4 !== null ? (
                        `···· ${line.card_last4}`
                      ) : (
                        <span className="text-warning-600 dark:text-warning-400">not recorded</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {money(line.total)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">
                      {money(line.discount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
