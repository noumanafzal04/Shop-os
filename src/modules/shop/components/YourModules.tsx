import { useMemo } from "react";

import { useShopModules } from "../hooks/useShop";

/**
 * WHAT THIS SHOP HAS, AND WHAT IT HAS NOT.
 *
 * ── Why a shop is shown this at all ─────────────────────────────────────
 *
 * Modules are the admin's decision and stay that way: a shop able to switch its
 * own till off would be a support call, and one able to switch stock off would
 * silently strand every figure it had.
 *
 * But "why can I not see Purchases" is a question a shopkeeper asks, and until
 * now it had nowhere to look. A screen that has simply vanished reads as a
 * broken product — and the honest answer, that this shop was not given that
 * part, takes one sentence.
 *
 * ── Why the OFF ones are listed too ─────────────────────────────────────
 *
 * A list of what you have answers half the question. The half that sends
 * somebody to support is the other one: it is not missing, it is available and
 * not switched on — which is a thing they can ASK for, in the words the admin
 * will recognise, rather than describing a screen they have never seen.
 */
export function YourModules() {
  const modules = useShopModules();

  const groups = useMemo(() => {
    const out = new Map<string, NonNullable<typeof modules.data>>();
    for (const m of modules.data ?? []) {
      out.set(m.group, [...(out.get(m.group) ?? []), m]);
    }

    return [...out.entries()];
  }, [modules.data]);

  if (modules.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  }

  if (modules.isError) {
    return (
      <p className="text-theme-sm text-error-500">
        Couldn&apos;t load what your shop has. Try again in a moment.
      </p>
    );
  }

  const on = (modules.data ?? []).filter((m) => m.enabled).length;
  const total = (modules.data ?? []).length;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">
          Your shop has {on} of {total} parts switched on
        </h3>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          This is why some screens are here and others are not. It is set for your shop when it is
          opened and changed only by support — nothing you do here, and no renewal, can move it. If
          you need a part that is off, ask support for it by the name below.
        </p>
      </div>

      {groups.map(([group, items]) => (
        <section
          key={group}
          className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h4 className="text-theme-xs font-medium uppercase tracking-wide text-gray-400">{group}</h4>
            <span className="text-theme-xs tabular-nums text-gray-400">
              {items.filter((m) => m.enabled).length} of {items.length}
            </span>
          </div>

          <ul className="space-y-2.5">
            {items.map((m) => (
              <li key={m.key} className="flex items-start gap-3">
                {/* State in FORM as well as colour: a dot that differs only by
                    hue says nothing to somebody who cannot tell them apart. */}
                <span
                  aria-hidden
                  className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    m.enabled
                      ? "bg-success-500/15 text-success-600 dark:text-success-500"
                      : "bg-gray-200 text-gray-400 dark:bg-gray-800"
                  }`}
                >
                  {m.enabled ? "✓" : "—"}
                </span>
                <span className="min-w-0">
                  <span
                    className={`text-sm font-medium ${m.enabled ? "text-gray-800 dark:text-white/90" : "text-gray-400"}`}
                  >
                    {m.label}
                  </span>
                  <span className="sr-only">{m.enabled ? " — on" : " — not switched on"}</span>
                  <span className="block text-theme-xs text-gray-500 dark:text-gray-400">{m.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
