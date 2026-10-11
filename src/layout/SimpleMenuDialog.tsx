import { createPortal } from "react-dom";

import Switch from "../components/form/switch/Switch";
import Button from "../components/ui/button/Button";
import { Modal } from "../components/ui/modal";
import type { NavItem } from "./navItem";
import { SHOP } from "./shopNav";
import { ALWAYS_SHOWN, isOwnChoice, simplePaths, withSwitched, NO_CHOICE, type SimpleChoice } from "./simpleMenu";

/**
 * YOUR SIMPLE MENU — the screen behind the gear on the rail.
 *
 * Every screen this person can open, in the order and under the names the
 * menu itself uses, each with a switch. On means it is on their Simple view.
 *
 * A switch takes effect as it is pressed: there is no Save, because there is
 * nothing here to get wrong that the next press does not put right, and the
 * menu changing behind the dialog is the confirmation.
 *
 * It is handed the menu IN FULL and decides nothing about who may see what —
 * a screen that is not listed cannot be switched on, and the list was already
 * narrowed to what the shop has and what this person may open.
 *
 * ── Drawn on the page, not inside the rail ─────────────────────────────
 *
 * It is opened from the sidebar, and a dialog mounted where it is opened
 * sits UNDER the header: the two share a layer and the header comes later.
 * Its title and its first rows were printed over by the search bar. So it is
 * handed to the document itself, the way a toast is.
 *
 * The list scrolls and the title and the buttons do not — a menu with HR
 * switched on is forty rows, and "Done" should not be forty rows away.
 */
type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** The whole menu, groups as groups — not the tidied one the rail draws. */
  menu: NavItem[];
  choice: SimpleChoice;
  onChange: (next: SimpleChoice) => void;
  /** What the third part of the rail is called for this business. */
  shopHeading: string;
  /** Whether the rail behind is showing the Simple view right now. */
  showingSimple: boolean;
  onShowSimple: () => void;
};

export default function SimpleMenuDialog({
  isOpen, onClose, menu, choice, onChange, shopHeading, showingSimple, onShowSimple,
}: Props) {
  if (!isOpen) return null;

  const shown = simplePaths(menu, choice);
  const flip = (paths: string[], on: boolean) => onChange(withSwitched(menu, choice, paths, on));

  // The parts of the rail, in the order it draws them.
  const parts = menu.reduce<Array<{ heading: string; rows: NavItem[] }>>((all, row) => {
    const heading = row.section ?? "";
    const last = all[all.length - 1];
    if (last && last.heading === heading) last.rows.push(row);
    else all.push({ heading, rows: [row] });

    return all;
  }, []);

  return createPortal(
    <Modal isOpen onClose={onClose} className="max-w-xl p-6">
      <h3 className="pr-12 text-lg font-semibold text-gray-800 dark:text-white/90">Your Simple menu</h3>
      {/* Clear of the close button, which sits over this corner. */}
      <p className="mt-1 pr-12 text-theme-sm text-gray-500 dark:text-gray-400">
        Switch on what you open every day and switch off the rest. This is your own menu, on this device —
        Full view always has everything.
      </p>

      <div
        className="custom-scrollbar -mx-2 mt-5 max-h-[min(58dvh,34rem)] space-y-6 overflow-y-auto overscroll-contain px-2 pb-1"
        data-testid="simple-menu"
      >
        {parts.map((part) => (
          <section key={part.heading} aria-label={part.heading === SHOP ? shopHeading : part.heading}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {part.heading === SHOP ? shopHeading : part.heading}
            </p>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {part.rows.map((row) => {
                if (row.path !== undefined) {
                  const fixed = row.path === ALWAYS_SHOWN;

                  return (
                    <li key={row.path} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <Switch
                        label={row.name}
                        checked={shown.has(row.path)}
                        disabled={fixed}
                        onChange={(on) => flip([row.path as string], on)}
                      />
                      {fixed && <span className="text-theme-xs text-gray-400">Always shown</span>}
                    </li>
                  );
                }

                const inside = row.subItems ?? [];
                const on = inside.filter((sub) => shown.has(sub.path)).length;

                return (
                  <li key={row.name} className="px-4 py-2.5" data-testid={`simple-menu-group-${row.name}`}>
                    <div className="flex items-center justify-between gap-3">
                      {/* The group's own switch is every screen in it at
                          once. Part-on reads as on: pressing it then turns
                          the rest OFF, which is the press that tidies up. */}
                      <Switch
                        label={row.name}
                        checked={on > 0}
                        onChange={(next) => flip(inside.map((sub) => sub.path), next)}
                      />
                      <span className="shrink-0 text-theme-xs tabular-nums text-gray-400">
                        {on} of {inside.length}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-2 border-l border-gray-200 pl-4 dark:border-gray-800">
                      {inside.map((sub) => (
                        <li key={sub.path}>
                          <Switch
                            label={sub.name}
                            checked={shown.has(sub.path)}
                            onChange={(next) => flip([sub.path], next)}
                          />
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* Chosen in Full view, the menu behind has not moved — so say where the
          result is, and offer to go there. */}
      {!showingSimple && (
        <p className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-theme-sm text-gray-600 dark:bg-white/[0.03] dark:text-gray-300">
          You are in Full view, which shows everything.{" "}
          <button type="button" onClick={onShowSimple} className="font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">
            Switch to Simple
          </button>{" "}
          to see this menu.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!isOwnChoice(menu, choice)}
          onClick={() => onChange(NO_CHOICE)}
        >
          Back to the usual menu
        </Button>
        <Button type="button" size="sm" onClick={onClose}>Done</Button>
      </div>
    </Modal>,
    document.body,
  );
}
