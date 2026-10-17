import { useQuery } from "@tanstack/react-query";

import Label from "../../../components/form/Label";
import { tillService } from "../../pos/services/tillService";
import { registerService } from "../../registers/services/registerService";
import { useAuthStore } from "../../../stores/authStore";
import { asksForApproval, type ApprovalState } from "../refundApproval";

const SELECT =
  "h-11 w-full rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300";

/**
 * WHOSE DRAWER, AND WHO SAYS YES — on the return, exchange and void sheets.
 *
 * See refundApproval.ts. A supervisor with no drawer of their own picks the
 * cashier's drawer the notes come out of (only who may read the tills is
 * shown them); a cashier, or anyone naming another drawer, is asked for a
 * supervisor and their PIN. The server checks every part of it again.
 *
 * A void (Q18) is approved by somebody who may void, and its notes never go
 * back out of no drawer (B86) — so "no drawer" is not offered for one.
 */
export function RefundApproval({ needsApproval, ownDrawer, value, onChange, purpose = "refund", drawerNeeded = true }: {
  needsApproval: boolean;
  /** The person's own drawer state, from returns/worth or the sale's `void`. */
  ownDrawer: "open" | "practice" | "none" | null | undefined;
  value: ApprovalState;
  onChange: (next: ApprovalState) => void;
  purpose?: "refund" | "void";
  /** False when no notes go back across the counter (a card sale): no drawer to choose. */
  drawerNeeded?: boolean;
}) {
  const me = useAuthStore((st) => st.user);
  const readsTills = useAuthStore((st) => st.hasPermission("reports.view") || st.hasPermission("settings.manage"));
  const choosesDrawer = drawerNeeded && readsTills && ownDrawer !== "open";
  const asking = asksForApproval(value, needsApproval);

  const drawers = useQuery({
    queryKey: ["open-drawers-here"],
    queryFn: async () => (await registerService.shiftDay({ status: "open" })).data.sessions,
    enabled: choosesDrawer,
    staleTime: 30_000,
  });
  const roster = useQuery({
    queryKey: ["till-users"],
    queryFn: async () => (await tillService.roster()).data,
    enabled: asking,
    staleTime: 60_000,
  });

  const others = (drawers.data ?? []).filter((d) => d.status === "open" && d.user?.id !== me?.id);
  const mayApprove = (u: { approves_refunds?: boolean; approves_voids?: boolean }) =>
    purpose === "void" ? u.approves_voids === true : u.approves_refunds !== false;
  const approvers = (roster.data ?? []).filter((u) => mayApprove(u) && u.has_pin && !u.pin_locked);

  if (!choosesDrawer && !asking) return null;

  return (
    <div data-testid="refund-approval" className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      {choosesDrawer && (
        <div>
          <Label>Cash comes out of</Label>
          <select
            aria-label="Cash comes out of"
            className={SELECT}
            value={value.drawerId}
            onChange={(e) => onChange({
              ...value,
              drawerId: e.target.value,
              // Naming a drawer for yourself: you are the one saying yes.
              approverId: value.approverId || (e.target.value !== "" && approvers.some((u) => u.id === me?.id) ? me?.id ?? "" : ""),
            })}
          >
            <option value="">{purpose === "void" ? "Choose the drawer it comes out of" : "No drawer — not handed over at a till"}</option>
            {others.map((d) => (
              <option key={d.id} value={d.id}>
                {d.user?.name ?? "A cashier"}'s drawer{d.register?.name ? ` · ${d.register.name}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {asking && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Approved by</Label>
            <select
              aria-label="Approved by"
              className={SELECT}
              value={value.approverId}
              onChange={(e) => onChange({ ...value, approverId: e.target.value })}
            >
              <option value="">Choose a supervisor</option>
              {approvers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Their PIN</Label>
            <input
              aria-label="Supervisor's PIN"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              className={SELECT}
              value={value.pin}
              onChange={(e) => onChange({ ...value, pin: e.target.value.replace(/\D/g, "") })}
            />
          </div>
          {roster.isSuccess && approvers.length === 0 && (
            <p className="text-theme-xs text-gray-500 sm:col-span-2">
              Nobody who may approve this has a till PIN yet. A supervisor sets one under Security; the owner can set it under Staff.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
