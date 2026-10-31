import { useCallback, useRef, type SyntheticEvent } from "react";

import type { FormTab } from "./formTabs";

/**
 * A WRONG BOX ON ANOTHER TAB OPENS THAT TAB (#AZ12).
 *
 * The item form is a real `<form>`, so the browser checks every box before it
 * lets Save through: a pack's "how many" of −2 is refused by its own `min="0"`.
 * On the tab somebody is looking at, the browser points at the box and says
 * why. On a tab that is not open it cannot point at anything, so it cancels
 * the save and tells nobody — the only trace was "An invalid form control
 * with name='' is not focusable" in the developer console, and the shopkeeper
 * pressed Save again.
 *
 * Each tab's pane carries `data-form-tab`. The FIRST box the browser refuses on
 * a save decides: on the open tab the browser already says it; on another tab
 * that tab is opened and the box is pointed at, in the browser's own words.
 */
export function useWrongBoxOpensItsTab(activeTab: FormTab, setTab: (tab: FormTab) => void) {
  // The browser refuses every wrong box in one go; only the first one speaks.
  const said = useRef(false);

  return useCallback(
    (event: SyntheticEvent) => {
      if (said.current) return;
      said.current = true;

      const box = event.target as HTMLElement & { reportValidity?: () => boolean };
      const home = box.closest<HTMLElement>("[data-form-tab]")?.dataset.formTab as FormTab | undefined;

      if (!home || home === activeTab) {
        window.setTimeout(() => { said.current = false; }, 0);

        return;
      }

      setTab(home);
      // Once the tab is drawn: point at the box. Its own refusal fires again
      // while `said` still holds, so it does not send anybody anywhere twice.
      window.setTimeout(() => {
        box.focus();
        box.reportValidity?.();
        said.current = false;
      }, 0);
    },
    [activeTab, setTab],
  );
}
