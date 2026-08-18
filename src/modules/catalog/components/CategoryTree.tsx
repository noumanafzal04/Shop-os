import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import type { Category } from "../types";
import { insertionFor, moveTo, sameOrder } from "./reorder";

/**
 * The category tree: one row per category, nested, draggable, collapsible.
 *
 * ── What this replaced ──────────────────────────────────────────────────
 *
 * Six controls sat on every row at every depth, four of them styled by hand
 * (`↑`, `↓`, `+ Sub`, `Rename` were bare text; only Hide and Delete had been
 * swept). A shop with forty categories was reading two hundred and forty
 * controls, and reordering a menu meant clicking `↓` once per position.
 *
 * ── Sibling groups own their own drag ───────────────────────────────────
 *
 * Each level renders its own `<Branch>` with its own drag state, which is what
 * fences a drag to its siblings. That is not a simplification: `sort_order` is
 * only meaningful within a parent, and a drag that could cross parents would be
 * a MOVE — a different operation, with different consequences for the products
 * underneath.
 */

export interface TreeHandlers {
  onRename: (c: Category, name: string) => void;
  onToggleVisible: (c: Category) => void;
  onAddSub: (parentId: string, name: string) => void;
  onDelete: (c: Category) => void;
  onReorder: (rows: Array<{ id: string; parent_id: string | null; sort_order: number }>) => void;
  busy: boolean;
  /**
   * False while the list is filtered — and it must be.
   *
   * `sort_order` is written as the position of each row in the list, numbered
   * from zero. Do that to a FILTERED list and the rows that are hidden keep the
   * numbers they had, so the visible ones are renumbered on top of them: the
   * shop drags one category and silently reshuffles the ones it could not see.
   *
   * Caught in this file's own new code, by asking what the drag writes rather
   * than whether it works.
   */
  canReorder: boolean;
}

/** A grip that a finger can find. Sized for touch, not for a mouse pointer. */
function Grip({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  label,
}: {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      // The grip captures the pointer, so every later event is delivered HERE
      // even when the finger has travelled far outside it. Listening on an
      // overlay instead would never hear them.
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      // `touch-none` matters more than it looks: without it the browser reads a
      // vertical drag as a page scroll and the row never moves on a tablet.
      className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-gray-300 transition hover:bg-gray-100 hover:text-gray-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-400/40 active:cursor-grabbing dark:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-400"
    >
      {/* Two columns of dots — the grip every list in every app uses, so
          nobody has to be told what it is. */}
      <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" fill="currentColor">
        {[2, 8, 14].map((y) => (
          <g key={y}>
            <circle cx="2" cy={y} r="1.4" />
            <circle cx="8" cy={y} r="1.4" />
          </g>
        ))}
      </svg>
    </button>
  );
}

function Branch({
  nodes,
  depth,
  handlers,
  expanded,
  toggleExpanded,
  editing,
  setEditing,
  adding,
  setAdding,
}: {
  nodes: Category[];
  depth: number;
  handlers: TreeHandlers;
  expanded: Record<string, boolean>;
  toggleExpanded: (id: string) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  adding: string | null;
  setAdding: (id: string | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; mids: number[] } | null>(null);

  /**
   * The order this branch is showing, which is the server's until a drag lands.
   *
   * Without it the row snaps back to where it was for as long as the refetch
   * takes, and a shopkeeper who has just dragged something sees it jump home —
   * which reads as "that did not work" and gets done again.
   */
  const [order, setOrder] = useState<Category[] | null>(null);
  const rows = order ?? nodes;

  // The server has answered; its order is the truth again.
  useEffect(() => {
    setOrder(null);
  }, [nodes]);

  const [drag, setDrag] = useState<{ from: number; at: number; dy: number } | null>(null);

  const [subName, setSubName] = useState("");
  const [renameValue, setRenameValue] = useState("");

  const commit = (next: Category[]) => {
    if (sameOrder(rows, next)) return;
    setOrder(next);
    handlers.onReorder(
      next.map((c, idx) => ({ id: c.id, parent_id: c.parent_id, sort_order: idx })),
    );
  };

  const beginDrag = (e: ReactPointerEvent, index: number) => {
    if (handlers.busy || !handlers.canReorder) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const els = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(":scope > [data-row]") ?? [],
    );
    start.current = {
      y: e.clientY,
      mids: els.map((el) => {
        const box = el.getBoundingClientRect();

        return box.top + box.height / 2;
      }),
    };
    setDrag({ from: index, at: index, dy: 0 });
  };

  const onMove = (e: ReactPointerEvent) => {
    if (drag === null || start.current === null) return;
    setDrag({
      from: drag.from,
      dy: e.clientY - start.current.y,
      at: insertionFor(start.current.mids, e.clientY),
    });
  };

  const endDrag = () => {
    if (drag !== null) commit(moveTo(rows, drag.from, drag.at));
    start.current = null;
    setDrag(null);
  };

  /** Arrow keys do the same job, because a grip is not reachable by keyboard. */
  const nudge = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= rows.length || !handlers.canReorder) return;
    commit(moveTo(rows, index, dir === 1 ? to + 1 : to));
  };

  return (
    <div ref={listRef} className={depth > 0 ? "ml-4 border-l border-gray-200 pl-2 dark:border-gray-800" : ""}>
      {rows.map((c, i) => {
        const kids = c.children ?? [];
        const open = expanded[c.id] !== false;
        const dragging = drag?.from === i;

        return (
          <div key={c.id} data-row>
            {/* Where it will land. Drawn above the row the pointer has reached,
                which is the only part of a drag a person actually watches. */}
            {drag !== null && drag.at === i && !dragging && (
              <div className="h-0.5 rounded-full bg-brand-500" />
            )}

            <div
              className={`group flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-1 py-1.5 transition ${
                dragging
                  ? "relative z-10 bg-white shadow-sm ring-1 ring-brand-300 dark:bg-gray-900 dark:ring-brand-500/40"
                  : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
              }`}
              style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
            >
              {/* Hidden rather than disabled while filtered: a grip that does
                  nothing when pulled is a broken list, not a locked one. */}
              {handlers.canReorder ? (
                <Grip
                  label={`Reorder ${c.name}`}
                  onPointerDown={(e) => beginDrag(e, i)}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      nudge(i, -1);
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      nudge(i, 1);
                    }
                  }}
                />
              ) : (
                <span className="h-9 w-7 shrink-0" />
              )}

              {/* The twisty, or a gap the same size so names stay in a column. */}
              {kids.length > 0 ? (
                <button
                  type="button"
                  onClick={() => toggleExpanded(c.id)}
                  aria-expanded={open}
                  aria-label={open ? `Collapse ${c.name}` : `Expand ${c.name}`}
                  className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06]"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    aria-hidden="true"
                    className={`transition-transform ${open ? "rotate-90" : ""}`}
                  >
                    <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <span className="h-7 w-6 shrink-0" />
              )}

              {editing === c.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Input
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && renameValue.trim()) handlers.onRename(c, renameValue.trim());
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={handlers.busy || !renameValue.trim()}
                    onClick={() => handlers.onRename(c, renameValue.trim())}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className={`truncate text-sm font-medium ${
                        c.is_active ? "text-gray-800 dark:text-white/90" : "text-gray-400 line-through"
                      }`}
                    >
                      {c.name}
                    </span>

                    {!c.is_active && (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-theme-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        Hidden
                      </span>
                    )}

                    {/* Collapsing must not hide the fact that there is
                        something under here. */}
                    {kids.length > 0 && !open && (
                      <span className="shrink-0 rounded-full bg-brand-500/10 px-2 py-0.5 text-theme-xs font-medium text-brand-600 dark:text-brand-400">
                        {kids.length} inside
                      </span>
                    )}

                    {/* The count is a way THROUGH, not a fact. It was a dead
                        number: the only way to see what was in a category was
                        to go to Products and find it in the filter again. */}
                    {!!c.products_count && (
                      <Link
                        to={`/tenant/products?category=${c.id}`}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-theme-xs tabular-nums text-gray-400 transition hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-white/[0.06] dark:hover:text-brand-400"
                      >
                        {c.products_count} {c.products_count === 1 ? "item" : "items"}
                      </Link>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <button className={ROW_ACTION} onClick={() => setAdding(adding === c.id ? null : c.id)}>
                      Add sub
                    </button>
                    <button
                      className={ROW_ACTION}
                      onClick={() => {
                        setRenameValue(c.name);
                        setEditing(c.id);
                      }}
                    >
                      Rename
                    </button>
                    <button className={ROW_ACTION} onClick={() => handlers.onToggleVisible(c)}>
                      {c.is_active ? "Hide" : "Show"}
                    </button>
                    <button className={ROW_ACTION_DANGER} onClick={() => handlers.onDelete(c)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>

            {adding === c.id && (
              <div className="ml-8 flex flex-wrap items-center gap-2 py-2">
                <Input
                  placeholder={`New subcategory under ${c.name}`}
                  value={subName}
                  autoFocus
                  onChange={(e) => setSubName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && subName.trim()) {
                      handlers.onAddSub(c.id, subName.trim());
                      setSubName("");
                    }
                    if (e.key === "Escape") setAdding(null);
                  }}
                />
                <Button
                  size="sm"
                  disabled={handlers.busy || !subName.trim()}
                  onClick={() => {
                    handlers.onAddSub(c.id, subName.trim());
                    setSubName("");
                  }}
                >
                  Add
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
              </div>
            )}

            {kids.length > 0 && open && (
              <Branch
                nodes={kids}
                depth={depth + 1}
                handlers={handlers}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                editing={editing}
                setEditing={setEditing}
                adding={adding}
                setAdding={setAdding}
              />
            )}
          </div>
        );
      })}

      {/* The last slot, which otherwise has no row to draw a line above. */}
      {drag !== null && drag.at === rows.length && (
        <div className="h-0.5 rounded-full bg-brand-500" />
      )}

    </div>
  );
}

export function CategoryTree({
  roots,
  handlers,
}: {
  roots: Category[];
  handlers: TreeHandlers;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  return (
    <Branch
      nodes={roots}
      depth={0}
      handlers={handlers}
      expanded={expanded}
      toggleExpanded={(id) => setExpanded((e) => ({ ...e, [id]: e[id] === false }))}
      editing={editing}
      setEditing={setEditing}
      adding={adding}
      setAdding={setAdding}
    />
  );
}
