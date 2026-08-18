import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { BoxIcon, FileIcon, GroupIcon, ListIcon, UserIcon } from "../../../icons";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useMoney } from "../../shop/hooks/useShop";
import { useGlobalSearch } from "../hooks/useGlobalSearch";
import type { SearchHit, SearchType } from "../services/searchService";
import { saleSubtitle } from "../saleSubtitle";

/**
 * ⌘K command palette. One box that jumps to any product, customer, sale, order
 * or supplier. The backend returns typed groups (gated by the user's
 * permissions); this component owns the type→route mapping and keyboard flow.
 */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q, 300);
  const { data, isFetching } = useGlobalSearch(open ? debounced : "");
  const navigate = useNavigate();
  const money = useMoney();
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);

  const groups = data?.groups ?? [];

  // A flat, index-addressable list of every hit across all groups — the unit
  // the arrow keys walk over.
  const flat = useMemo(
    () => groups.flatMap((g) => g.items.map((item) => ({ type: g.type, item }))),
    [groups],
  );

  // Reset the cursor whenever the result set changes.
  useEffect(() => setActive(0), [debounced, data]);

  // Fresh box + focus each time it opens; clear the query when it closes.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
    setQ("");
  }, [open]);

  if (!open) return null;

  const go = (type: SearchType, item: SearchHit) => {
    onClose();
    navigate(routeFor(type, item));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[active];
      if (hit) go(hit.type, hit.item);
    }
  };

  const hasQuery = q.trim().length >= 2;

  return (
    <div className="fixed inset-0 z-[999999] flex items-start justify-center px-4 pt-[12dvh]">
      {/* Backdrop — light, no heavy blur (matches the app's modal treatment). */}
      <div className="absolute inset-0 bg-gray-900/30 dark:bg-black/50" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900"
        onKeyDown={onKeyDown}
      >
        {/* Search field */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 dark:border-gray-800">
          <SearchGlyph />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products, customers, sales, orders…"
            className="h-14 w-full bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-white/90 dark:placeholder:text-white/30"
          />
          {isFetching && hasQuery && (
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          )}
          <kbd className="hidden shrink-0 rounded-md border border-gray-200 px-1.5 py-0.5 text-theme-xs text-gray-400 dark:border-gray-700 sm:inline">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[52dvh] overflow-y-auto py-2">
          {!hasQuery ? (
            <Hint>Type at least two characters to search across your shop.</Hint>
          ) : flat.length === 0 && !isFetching ? (
            <Hint>
              No matches for “<span className="font-medium text-gray-600 dark:text-gray-300">{q.trim()}</span>”.
            </Hint>
          ) : (
            groups.map((group) => (
              <div key={group.type} className="mb-1 last:mb-0">
                <p className="px-4 pb-1 pt-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const idx = flat.findIndex((f) => f.type === group.type && f.item.id === item.id);
                  const view = present(group.type, item, money);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(group.type, item)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        idx === active ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TYPE_TONE[group.type]}`}
                      >
                        {TYPE_ICON[group.type]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-800 dark:text-white/90">
                          {view.primary}
                        </span>
                        {view.secondary && (
                          <span className="block truncate text-theme-xs text-gray-400">{view.secondary}</span>
                        )}
                      </span>
                      {view.right && (
                        <span className="shrink-0 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                          {view.right}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint bar */}
        <div className="flex items-center gap-4 border-t border-gray-100 px-4 py-2 text-theme-xs text-gray-400 dark:border-gray-800">
          <span className="flex items-center gap-1">
            <Key>↑</Key>
            <Key>↓</Key>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <Key>↵</Key>
            open
          </span>
          {typeof data?.total === "number" && hasQuery && (
            <span className="ml-auto">
              {data.total} result{data.total === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Type → frontend route. Products deep-link to their editor; the rest land on
 *  their list page pre-filtered by the matched term (see list-page `?q=`). */
function routeFor(type: SearchType, item: SearchHit): string {
  switch (type) {
    case "product":
      return `/tenant/products/${item.id}/edit`;
    case "customer":
      return `/tenant/customers?q=${encodeURIComponent((item as { name: string }).name)}`;
    case "sale":
      return `/tenant/sales?q=${encodeURIComponent((item as { invoice_number: string }).invoice_number)}`;
    case "order":
      return `/tenant/orders`;
    case "supplier":
      return `/tenant/suppliers`;
  }
}

/** Turn a raw hit into the three display slots the row renders. */
function present(
  type: SearchType,
  item: SearchHit,
  money: (n: string | number) => string,
): { primary: string; secondary?: string | null; right?: string | null } {
  switch (type) {
    case "product": {
      const p = item as import("../services/searchService").ProductHit;
      const stock = p.stock_quantity != null ? ` · ${Number(p.stock_quantity)} in stock` : "";
      return { primary: p.name, secondary: (p.sku ? `SKU ${p.sku}` : p.item_type) + stock, right: money(p.price) };
    }
    case "customer": {
      const c = item as import("../services/searchService").CustomerHit;
      const owes = Number(c.credit_balance) > 0 ? `Owes ${money(c.credit_balance)}` : null;
      return { primary: c.name, secondary: c.phone, right: owes };
    }
    case "sale": {
      const s = item as import("../services/searchService").SaleHit;
      return { primary: s.invoice_number, secondary: saleSubtitle(s), right: money(s.total) };
    }
    case "order": {
      const o = item as import("../services/searchService").OrderHit;
      return { primary: o.order_number, secondary: o.customer_name, right: o.status };
    }
    case "supplier": {
      const s = item as import("../services/searchService").SupplierHit;
      return { primary: s.name, secondary: s.contact_person ?? s.phone };
    }
  }
}

const TYPE_ICON: Record<SearchType, React.ReactNode> = {
  product: <BoxIcon className="size-4" />,
  customer: <UserIcon className="size-4" />,
  sale: <FileIcon className="size-4" />,
  order: <ListIcon className="size-4" />,
  supplier: <GroupIcon className="size-4" />,
};

const TYPE_TONE: Record<SearchType, string> = {
  product: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
  customer: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  sale: "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400",
  order: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  supplier: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-gray-400">{children}</p>;
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-gray-200 px-1 py-0.5 font-sans text-theme-xs text-gray-400 dark:border-gray-700">
      {children}
    </kbd>
  );
}

function SearchGlyph() {
  return (
    <svg className="size-5 shrink-0 fill-gray-400" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z"
      />
    </svg>
  );
}
