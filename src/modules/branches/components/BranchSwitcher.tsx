import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";
import { useBranchStore } from "../../../stores/branchStore";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches } from "../hooks/useBranches";
import { branchRows, findBranches, FIND_FROM, step, type BranchRow } from "../branchMenu";

/** One building, seen from a corner: a single branch. */
function BranchGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3 7l7-4 7 4-7 4-7-4z" strokeLinejoin="round" />
      <path d="M3 7v6l7 4 7-4V7" strokeLinejoin="round" />
    </svg>
  );
}

/** Every branch at once: four squares. */
function AllGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="3" width="5.5" height="5.5" rx="1.2" />
      <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2" />
      <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

/**
 * WHERE THE MENU HANGS.
 *
 * From `sm` up, off the control's own right edge. On a phone the control is
 * not at the edge of the screen — the bell and the account are to its right —
 * so a panel hung from it ran off the LEFT of the screen. There it is pinned
 * to the screen instead, under the header, the way the notifications are.
 */
const PANEL =
  "fixed inset-x-3 top-[4.25rem] z-[99999] sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 " +
  "overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-700 dark:bg-gray-900";

/**
 * Header control that lets an owner choose which branch they're operating on.
 * The choice is sent as X-Branch-Id on every request, so POS/sales hit that
 * branch's stock. Hidden for single-branch shops; staff are pinned to their
 * assigned branch server-side and are only TOLD which it is.
 *
 * ── What it looked like, and what was wrong with that ──────────────────
 *
 * A bordered button reading "All branches", and under it a list of names.
 *
 *   · Nothing about the button changed when ONE branch was chosen, except the
 *     word on it. This control exists to stop somebody reading one branch's
 *     stock while believing they are reading the shop's — and it said so in
 *     the same grey either way. Chosen, it is tinted now.
 *   · Two rows explained nothing: "All branches — HQ" and "Main — Main".
 *   · It could not be used from a keyboard at all, and told a screen reader
 *     only that it was a button.
 *   · A shop with fifteen branches scrolled a list with no way to find one.
 *   · On a phone it was not drawn. An owner standing in the second branch
 *     with a phone could neither see nor change which branch the figures on
 *     screen belonged to.
 */
export default function BranchSwitcher() {
  const role = useAuthStore((s) => s.user?.role);
  const myBranchId = useAuthStore((s) => s.user?.branch_id);
  const settings = useShopSettings();
  const multiBranchSetting = settings.data ? settings.data.max_branches !== 1 : false;
  // Owners need the list to CHOOSE from. Staff need it to read one name off —
  // their own — and they may not be allowed it at all: `/branches` takes any of
  // seven permissions and a kitchen hand holds none of them. An unresolved name
  // renders nothing rather than a guess.
  const branches = useBranches(multiBranchSetting && (role === "shop_owner" || Boolean(myBranchId)));
  const { activeBranchId, setActiveBranch } = useBranchStore();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [lit, setLit] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const menuId = useId();

  const list = useMemo(() => branches.data ?? [], [branches.data]);
  const rows = useMemo(() => branchRows(list), [list]);
  const shown = useMemo(() => findBranches(rows, typed), [rows, typed]);
  const canFind = list.length >= FIND_FROM;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Opened: the row that is chosen is the one lit, and the keys go to the
  // menu (or to the box, where there is one to type in).
  useEffect(() => {
    if (!open) return;
    setTyped("");
    setLit(Math.max(0, rows.findIndex((r) => r.id === (activeBranchId ?? null))));
    const t = setTimeout(() => (canFind ? findRef.current : listRef.current)?.focus(), 20);

    return () => clearTimeout(t);
    // Only on opening: re-running on `rows` would move the light under a hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!multiBranchSetting) return null;

  /**
   * A STAFF MEMBER IS TOLD WHERE THEY ARE, AND CANNOT MOVE.
   *
   * `ResolveBranch` pins staff to `users.branch_id` and a header can never move
   * them, so they were never wrong about which branch they were on — they
   * simply could not KNOW. This control returned null for them and nothing else
   * named the branch, which on a two-branch shop means a person counting a
   * drawer has no way to check whose drawer it is.
   *
   * Read-only on purpose: the pin is the owner's decision, made on the staff
   * screen. Offering a switch that the server ignores would be worse than
   * silence.
   */
  if (role !== "shop_owner") {
    const mine = list.find((b) => b.id === myBranchId);
    if (!mine) return null;

    return (
      <div
        className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300"
        title={`You work at ${mine.name}`}
        data-testid="branch-pinned"
      >
        <BranchGlyph className="h-4 w-4 shrink-0 text-gray-400" />
        {/* On a phone the name is what there is room for, and it is the point. */}
        <span className="max-w-[6.5rem] truncate font-medium sm:max-w-[10rem]">{mine.name}</span>
      </div>
    );
  }

  if (list.length < 2) return null;

  // null activeBranchId = "All branches" (the HQ reporting view). A specific
  // id focuses both operations (POS writes) and reports on that branch.
  const active = activeBranchId ? list.find((b) => b.id === activeBranchId) : null;
  const label = active?.name ?? "All branches";
  const scoped = active != null;

  const choose = (id: string | null) => {
    setActiveBranch(id);
    setOpen(false);
    trigger.current?.focus();
    // EVERYTHING, not a list.
    //
    // The branch is sent as X-Branch-Id on every request, so changing it
    // changes the answer to almost every tenant-scoped read — but none of the
    // query keys carry the branch, so a cached answer for the old branch stays
    // cached under the same key. Four keys were named here and the Inventory
    // screens were not among them: switch to a second branch, open Needs
    // reordering, and it kept showing the FIRST branch's list, under the
    // second branch's name, until the page was navigated away from and back.
    //
    // A list of branch-scoped keys is a list somebody has to maintain, and it
    // was wrong within a month. Refetching the active queries is the cost of
    // changing which shop you are looking at, and it is the right cost.
    void qc.invalidateQueries();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setLit((at) => step(at, shown.length, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setLit(shown.length === 0 ? -1 : e.key === "Home" ? 0 : shown.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = shown[lit];
      if (row) choose(row.id);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const optionId = (row: BranchRow) => `${menuId}-${row.id ?? "all"}`;

  return (
    <div className="relative" ref={ref}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // Down opens it, the way a select does.
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Operating branch: ${label}`}
        title={scoped ? `Showing ${label} only` : "Showing every branch together"}
        data-testid="branch-switcher"
        data-scope={scoped ? "branch" : "all"}
        className={`flex h-11 items-center gap-2.5 rounded-xl border px-2.5 text-left transition-colors sm:px-3 ${
          scoped
            ? // ONE branch: the figures on screen are not the shop's. Said in colour.
              "border-brand-300 bg-brand-50 text-brand-700 hover:border-brand-400 dark:border-brand-500/40 dark:bg-brand-500/15 dark:text-brand-300"
            : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:bg-transparent dark:text-gray-300 dark:hover:border-gray-700"
        } ${open ? "ring-2 ring-brand-500/20" : ""}`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
            scoped ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
          }`}
        >
          {scoped ? <BranchGlyph className="h-3.5 w-3.5" /> : <AllGlyph className="h-3.5 w-3.5" />}
        </span>
        {/* The name from `sm` up. On a phone the mark is the control and the
            tint is the news; the name is one tap away, at the head of the menu. */}
        <span className="hidden min-w-0 sm:block">
          <span className={`block text-[10px] font-medium uppercase leading-3 tracking-wide ${scoped ? "text-brand-600/80 dark:text-brand-300/80" : "text-gray-400"}`}>
            Branch
          </span>
          <span className="block max-w-[9rem] truncate text-theme-sm font-semibold leading-4 lg:max-w-[11rem]">{label}</span>
        </span>
        <svg className={`hidden h-4 w-4 shrink-0 transition-transform sm:block ${open ? "rotate-180" : ""} ${scoped ? "text-brand-500" : "text-gray-400"}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5.5 7.5l4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className={PANEL} onKeyDown={onKeyDown}>
          <div className="border-b border-gray-100 px-4 pb-3 pt-3.5 dark:border-gray-800">
            <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">Operating branch</p>
            <p className="mt-0.5 text-theme-xs leading-4 text-gray-500 dark:text-gray-400">
              What you see, sell and count is this branch&rsquo;s.
            </p>
            {canFind && (
              <input
                ref={findRef}
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setLit(0);
                }}
                placeholder="Find a branch…"
                aria-label="Find a branch"
                aria-controls={menuId}
                className="mt-3 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-theme-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/15 dark:border-gray-700 dark:bg-white/[0.03] dark:text-white/90"
              />
            )}
          </div>

          <div
            ref={listRef}
            id={menuId}
            role="listbox"
            aria-label="Operating branch"
            tabIndex={-1}
            aria-activedescendant={shown[lit] ? optionId(shown[lit]) : undefined}
            className="max-h-[min(22rem,60dvh)] overflow-y-auto p-1.5 focus:outline-none"
          >
            {shown.length === 0 ? (
              <p className="px-3 py-6 text-center text-theme-sm text-gray-500 dark:text-gray-400">
                No branch called &ldquo;{typed.trim()}&rdquo;.
              </p>
            ) : (
              shown.map((row, at) => {
                const chosen = row.id === (activeBranchId ?? null);

                return (
                  <button
                    key={row.id ?? "all"}
                    id={optionId(row)}
                    type="button"
                    role="option"
                    aria-selected={chosen}
                    tabIndex={-1}
                    onMouseEnter={() => setLit(at)}
                    onClick={() => choose(row.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
                      at === lit ? "bg-gray-100 dark:bg-white/[0.06]" : ""
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        chosen
                          ? "bg-brand-500 text-white"
                          : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
                      }`}
                    >
                      {row.id === null ? <AllGlyph /> : <BranchGlyph />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-theme-sm font-medium ${chosen ? "text-brand-700 dark:text-brand-300" : "text-gray-800 dark:text-white/90"}`}>
                          {row.name}
                        </span>
                        {row.tag && (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${
                              row.tag === "Closed"
                                ? "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
                                : "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                            }`}
                          >
                            {row.tag}
                          </span>
                        )}
                      </span>
                      {row.note && <span className="block truncate text-theme-xs text-gray-500 dark:text-gray-400">{row.note}</span>}
                    </span>
                    {chosen && (
                      <svg className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M5 10.5l3.2 3.2L15 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-2.5 dark:border-gray-800">
            {/* Keys, for a device that has them. */}
            <span className="hidden whitespace-nowrap text-theme-xs text-gray-400 sm:block">↑ ↓ move · Enter choose</span>
            <Link
              to="/tenant/branches"
              onClick={() => setOpen(false)}
              className="ml-auto whitespace-nowrap text-theme-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
            >
              Manage branches
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
