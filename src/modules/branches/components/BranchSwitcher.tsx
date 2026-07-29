import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";
import { useBranchStore } from "../../../stores/branchStore";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches } from "../hooks/useBranches";

/**
 * Header control that lets an owner choose which branch they're operating on.
 * The choice is sent as X-Branch-Id on every request, so POS/sales hit that
 * branch's stock. Hidden for single-branch shops and for staff (who are pinned
 * to their assigned branch server-side).
 */
export default function BranchSwitcher() {
  const role = useAuthStore((s) => s.user?.role);
  const settings = useShopSettings();
  const multiBranchSetting = settings.data ? settings.data.max_branches !== 1 : false;
  // Only owners on a multi-branch plan need the branch list.
  const branches = useBranches(role === "shop_owner" && multiBranchSetting);
  const { activeBranchId, setActiveBranch } = useBranchStore();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Owners only; single-branch shops never see it.
  if (role !== "shop_owner" || !multiBranchSetting) return null;

  const list = branches.data ?? [];
  if (list.length < 2) return null;

  // null activeBranchId = "All branches" (the HQ reporting view). A specific
  // id focuses both operations (POS writes) and reports on that branch.
  const active = activeBranchId ? list.find((b) => b.id === activeBranchId) : null;
  const label = active?.name ?? "All branches";

  const choose = (id: string | null) => {
    setActiveBranch(id);
    setOpen(false);
    // Branch-scoped views depend on the selection — refresh them.
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["branch-stock"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["sales"] });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 transition-colors hover:border-brand-300 dark:border-gray-800 dark:text-gray-300 dark:hover:border-brand-800"
      >
        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 7l7-4 7 4-7 4-7-4z" strokeLinejoin="round" />
          <path d="M3 7v6l7 4 7-4V7" strokeLinejoin="round" />
        </svg>
        <span className="max-w-[10rem] truncate font-medium">{label}</span>
        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5.5 7.5l4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-[99999] mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <p className="px-3 pb-1 pt-2 text-theme-xs uppercase tracking-wide text-gray-400">Operating branch</p>
          <button
            onClick={() => choose(null)}
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04] ${
              !activeBranchId ? "text-brand-600 dark:text-brand-400" : "text-gray-700 dark:text-gray-300"
            }`}
          >
            <span className="truncate">All branches</span>
            <span className="ml-2 text-theme-xs text-gray-400">HQ</span>
          </button>
          {list.map((b) => (
            <button
              key={b.id}
              onClick={() => choose(b.id)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04] ${
                b.id === active?.id ? "text-brand-600 dark:text-brand-400" : "text-gray-700 dark:text-gray-300"
              }`}
            >
              <span className="truncate">{b.name}</span>
              {b.is_default && <span className="ml-2 text-theme-xs text-gray-400">Main</span>}
              {b.id === active?.id && (
                <svg className="ml-2 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 10l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
