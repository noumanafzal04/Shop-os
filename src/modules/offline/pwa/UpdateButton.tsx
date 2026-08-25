import { useState } from "react";

import { useToast } from "../../../components/ui/toast";
import { checkForUpdate, type UpdateCheck } from "./checkForUpdate";
import { useUpdateStore } from "./updateStore";

/**
 * "IS THERE A NEWER CARTZE?" — asked on purpose, from the header.
 *
 * Two things were missing and this is both of them.
 *
 * A shop told "the new prices are live" had no way to go and get them. The
 * hourly check is right for something nobody should have to think about, and
 * useless the moment somebody IS thinking about it — they could only wait, or
 * reload and hope.
 *
 * And "Later" on the update strip was a one-way door: it dismissed the offer
 * and nothing on any screen mentioned the waiting version again. This is now
 * where that offer lives permanently, so refusing an update mid-shift costs
 * nothing.
 *
 * ── It says which of five things happened ──────────────────────────────
 *
 * "Nothing found" and "I could not look" are not the same sentence and a
 * shopkeeper acts differently on each — so a till on a dead line is told it has
 * no line, and a copy served over plain http is told it cannot update in place
 * rather than being reassured it is current. See `checkForUpdate`.
 */
const SAID: Record<UpdateCheck, { tone: "success" | "info" | "error"; text: string }> = {
  found: { tone: "success", text: "A new version is ready. Press Update when you are between customers." },
  installing: { tone: "info", text: "A new version is downloading. You will be offered it in a moment." },
  current: { tone: "info", text: "You are on the latest version." },
  // NOT an error, and deliberately not red. A till with no line is doing
  // exactly what it was built to do, and alarming a cashier mid-sale about
  // something that is not wrong is its own defect.
  offline: { tone: "info", text: "No connection, so we could not check. The till carries on selling either way." },
  unavailable: { tone: "info", text: "This copy cannot update itself — it was not installed as an app. Reload the page for the newest version." },
  // This one IS a failure: there was a line, we asked, and the ask did not
  // come back.
  failed: { tone: "error", text: "We could not reach the server to check. Try again shortly." },
};

export function UpdateButton() {
  const toast = useToast();
  const registration = useUpdateStore((s) => s.registration);
  const ready = useUpdateStore((s) => s.ready);
  const apply = useUpdateStore((s) => s.apply);
  const [checking, setChecking] = useState(false);

  // A NEW VERSION IS WAITING. The control stops being "go and look" and
  // becomes the way in — named, coloured, and impossible to lose behind a
  // dismissed strip.
  if (ready && apply) {
    return (
      <button
        type="button"
        onClick={apply}
        className="flex h-11 items-center gap-2 rounded-full bg-brand-500 px-4 text-theme-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
          <path d="M10 15V5m0 0l-4 4m4-4l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="hidden sm:inline">Update ready</span>
        <span className="sm:hidden">Update</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={checking}
      onClick={async () => {
        setChecking(true);
        try {
          const answer = await checkForUpdate(registration);
          const said = SAID[answer];
          if (said.tone === "success") toast.success(said.text);
          else if (said.tone === "error") toast.error(said.text);
          else toast.info(said.text);
        } finally {
          // In `finally`, so a thrown check does not leave the header
          // spinning for the rest of the shift.
          setChecking(false);
        }
      }}
      /* `aria-label` and not a title alone: this is an icon button, and its
         only name is the one a reader is given here. */
      aria-label={checking ? "Checking for updates" : "Check for updates"}
      title="Check for updates"
      className="relative flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className={`h-5 w-5 ${checking ? "animate-spin" : ""}`}
      >
        {/* Two arcs chasing each other — the shape every platform uses for
            "go and look again". Not a download arrow: nothing is coming down
            yet, and that is the whole question being asked. */}
        <path
          d="M16.5 8.2A6.8 6.8 0 0 0 4.6 5.6M3.5 11.8a6.8 6.8 0 0 0 11.9 2.6"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
        />
        <path d="M16.9 4.2v4h-4M3.1 15.8v-4h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
