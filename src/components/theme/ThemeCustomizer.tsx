import { useEffect, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useShopSettings, useUpdateShopSettings } from "../../modules/shop/hooks/useShop";
import {
  applyTenantTheme,
  DEFAULT_PRIMARY,
  THEME_PRESETS,
  type SidebarStyle,
  type TintLevel,
} from "../../common/theme/tenantTheme";

/**
 * Appearance, reachable from anywhere.
 *
 * A merchant decides how their shop should look while they're *using* it, not
 * while buried in a settings tab — so the control rides along on every screen
 * as a small rail button and opens a canvas over the page. Every change paints
 * LIVE against the real UI behind it; nothing persists until Save, and closing
 * without saving restores exactly what was stored.
 *
 * Scope is deliberately narrow — the four things that actually change how the
 * product feels. No layout variants, no top-bar palettes: they'd multiply the
 * surface we have to keep correct in light AND dark for no merchant gain.
 */

const GearGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
    <path
      d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path
      d="m19.4 13-.6-.4a6.9 6.9 0 0 0 0-1.2l.6-.4a1.5 1.5 0 0 0 .4-2l-.8-1.3a1.5 1.5 0 0 0-1.9-.6l-.7.3a6.9 6.9 0 0 0-1-.6l-.1-.8A1.5 1.5 0 0 0 13.8 4h-1.6a1.5 1.5 0 0 0-1.5 1.3l-.1.8c-.4.1-.7.3-1 .6l-.7-.3a1.5 1.5 0 0 0-1.9.6l-.8 1.3a1.5 1.5 0 0 0 .4 2l.6.4a6.9 6.9 0 0 0 0 1.2l-.6.4a1.5 1.5 0 0 0-.4 2l.8 1.3c.4.7 1.2.9 1.9.6l.7-.3c.3.3.6.5 1 .6l.1.8c.1.8.8 1.3 1.5 1.3h1.6c.8 0 1.4-.5 1.5-1.3l.1-.8c.4-.1.7-.3 1-.6l.7.3c.7.3 1.5.1 1.9-.6l.8-1.3a1.5 1.5 0 0 0-.4-2Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);
const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
    <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const SunGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
    <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
const MoonGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
);
const ResetGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
    <path d="M4 4v5h5M4.6 13a7.5 7.5 0 1 0 1.4-5.3L4 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A titled group inside the canvas. */
function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-gray-100 px-5 py-4 last:border-b-0 dark:border-gray-800">
      <h3 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{title}</h3>
      {hint && <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Equal-width choice tiles — the canvas's one selection idiom. */
function Choice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; preview?: React.ReactNode }>;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-2.5 text-theme-xs font-medium transition ${
              active
                ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300"
            }`}
          >
            {o.preview}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Miniature of the shell, so a sidebar choice is judged by shape not words. */
function SidebarPreview({ variant }: { variant: SidebarStyle }) {
  const rail =
    variant === "dark"
      ? "bg-gray-800"
      : variant === "tinted"
        ? "bg-gray-200 dark:bg-gray-700"
        : "bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700";
  return (
    <span className="flex h-7 w-12 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
      <span className={`w-3.5 ${rail}`} />
      <span className="flex-1 bg-gray-50 dark:bg-gray-800" />
    </span>
  );
}

export default function ThemeCustomizer() {
  const { theme, toggleTheme } = useTheme();
  const settings = useShopSettings();
  const update = useUpdateShopSettings();

  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // Working copy. Seeded from what's stored, and re-seeded whenever the stored
  // values change (another device, or our own save landing).
  const [primary, setPrimary] = useState<string | null>(null);
  const [tint, setTint] = useState<TintLevel>("subtle");
  const [sidebar, setSidebar] = useState<SidebarStyle>("light");

  const storedPrimary = settings.data?.theme_primary ?? null;
  const storedTint = (settings.data?.theme_tint ?? "subtle") as TintLevel;
  const storedSidebar = (settings.data?.theme_sidebar ?? "light") as SidebarStyle;

  useEffect(() => {
    setPrimary(storedPrimary);
    setTint(storedTint);
    setSidebar(storedSidebar);
  }, [storedPrimary, storedTint, storedSidebar]);

  // Paint the working copy while the canvas is open; on close, snap back to
  // what's stored so an abandoned experiment never lingers.
  useEffect(() => {
    if (open) applyTenantTheme({ primary, tint, sidebar });
    else applyTenantTheme({ primary: storedPrimary, tint: storedTint, sidebar: storedSidebar });
  }, [open, primary, tint, sidebar, storedPrimary, storedTint, storedSidebar]);

  // Esc closes, matching every other overlay in the product.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const dirty =
    primary !== storedPrimary || tint !== storedTint || sidebar !== storedSidebar;

  const save = () => {
    update.mutate(
      { theme_primary: primary, theme_tint: tint, theme_sidebar: sidebar } as never,
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2200);
        },
      },
    );
  };

  const resetAll = () => {
    setPrimary(null);
    setTint("subtle");
    setSidebar("light");
  };

  return (
    <>
      {/* Rail button — always reachable, never over the content. Hidden while
          the canvas is open so it can't sit on top of its own panel. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Appearance"
          aria-label="Open appearance settings"
          className="fixed right-0 top-1/2 z-[60] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-l-xl bg-brand-500 text-white transition hover:w-12 hover:bg-brand-600"
        >
          <GearGlyph />
        </button>
      )}

      {/* Scrim */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-[70] bg-gray-900/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Canvas */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Appearance"
        className={`fixed right-0 top-0 z-[80] flex h-screen w-[min(21rem,100vw)] flex-col bg-white transition-transform duration-200 dark:bg-gray-900 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-white/90">Appearance</h2>
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              Changes preview instantly. Save to apply for your shop.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5"
          >
            <CloseGlyph />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Group title="Color mode" hint="Saved on this device, for you only.">
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "light", label: "Light", icon: <SunGlyph /> },
                { v: "dark", label: "Dark", icon: <MoonGlyph /> },
              ] as const).map((o) => {
                const active = theme === o.v;
                return (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => { if (!active) toggleTheme(); }}
                    aria-pressed={active}
                    className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-theme-sm font-medium transition ${
                      active
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                        : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {o.icon}
                    {o.label}
                  </button>
                );
              })}
            </div>
          </Group>

          <Group title="Brand colour" hint="Drives buttons, links and highlights everywhere.">
            <div className="grid grid-cols-8 gap-1.5">
              {THEME_PRESETS.map((p) => {
                const isDefault = p.primary.toLowerCase() === DEFAULT_PRIMARY;
                const active = (primary ?? DEFAULT_PRIMARY).toLowerCase() === p.primary.toLowerCase();
                return (
                  <button
                    key={p.primary}
                    type="button"
                    title={p.name}
                    aria-label={p.name}
                    aria-pressed={active}
                    onClick={() => setPrimary(isDefault ? null : p.primary)}
                    className={`h-8 w-full rounded-lg border-2 transition ${
                      active ? "border-gray-900 dark:border-white" : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: p.primary }}
                  />
                );
              })}
            </div>
            <label className="mt-3 flex items-center gap-2.5">
              <input
                type="color"
                aria-label="Custom brand colour"
                value={primary ?? DEFAULT_PRIMARY}
                onChange={(e) => setPrimary(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-lg border border-gray-200 bg-transparent p-1 dark:border-gray-700"
              />
              <span className="text-theme-xs text-gray-500 dark:text-gray-400">
                Custom · <span className="font-mono uppercase">{primary ?? DEFAULT_PRIMARY}</span>
              </span>
            </label>
          </Group>

          <Group title="Sidebar" hint="The navigation rail's surface.">
            <Choice<SidebarStyle>
              value={sidebar}
              onChange={setSidebar}
              options={[
                { value: "light", label: "Light", preview: <SidebarPreview variant="light" /> },
                { value: "tinted", label: "Tinted", preview: <SidebarPreview variant="tinted" /> },
                { value: "dark", label: "Dark", preview: <SidebarPreview variant="dark" /> },
              ]}
            />
          </Group>

          <Group title="Surface tint" hint="How much your colour bleeds into backgrounds and cards.">
            <Choice<TintLevel>
              value={tint}
              onChange={setTint}
              options={[
                { value: "none", label: "None" },
                { value: "subtle", label: "Subtle" },
                { value: "strong", label: "Strong" },
              ]}
            />
          </Group>

          <div className="px-5 py-4">
            <p className="text-theme-xs text-gray-400">
              Status colours (green for success, red for errors) never change, so they keep their meaning.
            </p>
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={resetAll}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-theme-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <ResetGlyph /> Reset
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || update.isPending}
            className="flex-1 rounded-xl bg-brand-500 px-4 py-2.5 text-theme-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            {update.isPending ? "Saving…" : saved ? "Saved ✓" : dirty ? "Save" : "Saved ✓"}
          </button>
        </footer>
      </aside>
    </>
  );
}
