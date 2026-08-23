import { useEffect, useState } from "react";
import { useLocation } from "react-router";

import { useTheme } from "../../context/ThemeContext";
import { useAuthStore } from "../../stores/authStore";
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
/** Save: something going into the shop's record, not a floppy disk. */
const SaveGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
    <path d="M12 4v9m0 0 3.2-3.2M12 13l-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 15v2.5A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
/**
 * The tick DRAWS itself, once, when the save lands.
 *
 * A label that flips from "Save" to "Saved ✓" between two frames is a change
 * the eye can miss entirely — and this panel's whole job is telling somebody
 * their shop now looks different. A stroke that travels takes about a third of
 * a second and is impossible to miss. Reduced motion turns the travel off and
 * keeps the tick.
 */
const CheckGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
    <path
      className="draws-itself"
      d="m5 12.5 4.5 4.5L19 7.5"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const SpinnerGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2.2" strokeOpacity="0.3" />
    <path d="M20.5 12A8.5 8.5 0 0 0 12 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
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

  // Two different things live in this canvas and only one of them is yours.
  // Light/dark is a personal preference on this device. The brand colour,
  // sidebar and tint are the SHOP's look, saved for everyone, and PUT
  // /shop/settings asks for settings.manage. A cashier used to be shown all
  // four, and Save simply did nothing — the mutation 403'd with no onError,
  // then closing the canvas snapped the preview back to what was stored. It
  // read as "the theme will not update" rather than "this is not yours to
  // change", which is the same disguise the empty product grid wore.
  const canConfigure = useAuthStore((s) => s.hasPermission)("settings.manage");

  /**
   * Not on the till.
   *
   * The rail button is `fixed right-0 top-1/2`, which on every other screen
   * lands on a page margin. The POS has no margin — it is a full-bleed two-pane
   * till — so the gear sat directly on top of the cart's TOTAL column, which is
   * the single figure a cashier and a customer are both looking at.
   *
   * Nobody restyles their shop halfway through a queue either. Appearance is
   * one Esc away on the screen the owner sets it from.
   */
  const onTill = useLocation().pathname.startsWith("/tenant/pos");

  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setSaveError(null);
    update.mutate(
      { theme_primary: primary, theme_tint: tint, theme_sidebar: sidebar } as never,
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2200);
        },
        // A save that fails silently is indistinguishable from one that never
        // fired. Belt and braces: the controls are already hidden without the
        // permission, but if the server ever refuses for another reason, say so.
        onError: (e: unknown) =>
          setSaveError(e instanceof Error ? e.message : "Could not save. Try again."),
      },
    );
  };

  const resetAll = () => {
    setPrimary(null);
    setTint("subtle");
    setSidebar("light");
  };

  // Owner-only, in full. Everything in this canvas is the SHOP's look — saved
  // once, seen by everyone who works here — and PUT /shop/settings asks for
  // settings.manage. Showing a cashier controls whose Save can only fail is
  // worse than not showing them: the rail button is not offered at all.
  // Light/dark rides the header toggle instead, which is where a per-device
  // preference belongs anyway. Note the one gap that buys: the full-screen POS
  // renders outside AppLayout and so has no header, which leaves a cashier who
  // only ever works the till with no light/dark control at all. Acceptable
  // because the till now paints its own fixed two-tone ground and barely moves
  // between themes — but it IS a real consequence, not an oversight.
  //
  // Placed after every hook so the rules of hooks still hold.
  if (!canConfigure) return null;

  return (
    /* Not on a tablet, on the shop's own request — and `xl`, not `lg`.
     *
     * A tablet in landscape is 1024–1279, which IS `lg`: hiding below `lg`
     * would have left it on every tablet held the way shops hold them. 1280 is
     * the number this codebase already uses for "below here is tablet-sized"
     * (RAIL_STARTS_COLLAPSED_BELOW), so it is read from the same idea rather
     * than picked again.
     *
     * Why it had to go rather than be made bigger: the launcher is
     * `fixed right-0 top-1/2` — a target on the right edge of the glass, which
     * is exactly where a thumb rests while scrolling. On a touch screen the
     * canvas opened by accident, repeatedly, over whatever the shop was doing.
     * Nothing ever opened it "by default"; `open` has always started false.
     *
     * Nothing is lost that a tablet needs: this canvas is the SHOP's look,
     * owner-only, saved once for everyone — a thing you sit down to do.
     * Light/dark is a per-device choice and stays on the header toggle. */
    <div className="hidden xl:block">
      {/* Rail button — always reachable, never over the content. Hidden while
          the canvas is open so it can't sit on top of its own panel, and never
          drawn on the till (see `onTill` above). */}
      {!open && !onTill && (
        /**
         * A tab that says what it is.
         *
         * It was a plain square with a gear in it, and a gear on the right edge
         * of a business dashboard could be almost anything — shop settings,
         * printer setup, the thing you press by mistake. Hovering now widens it
         * and the word arrives, so nobody has to click to find out; the gear
         * turns a quarter while that happens, which is the small confirmation
         * that the thing is a control and not a decoration.
         *
         * All of it is `motion-safe`, and the WIDTH is what animates rather
         * than the position — a tab that slides in from the edge on hover is a
         * tab that moves out from under the pointer aiming at it.
         */
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Appearance"
          aria-label="Open appearance settings"
          className="group fixed right-0 top-1/2 z-[60] flex h-11 w-11 -translate-y-1/2 items-center gap-0 overflow-hidden rounded-l-xl bg-brand-500 pl-3 text-white shadow-theme-md transition-[width,background-color] duration-300 hover:w-36 hover:bg-brand-600 focus-visible:w-36 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <span className="shrink-0 transition-transform duration-500 motion-safe:group-hover:rotate-90 motion-safe:group-focus-visible:rotate-90">
            <GearGlyph />
          </span>
          <span className="ml-2.5 whitespace-nowrap text-theme-sm font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
            Appearance
          </span>
        </button>
      )}

      {/* Scrim — above the whole shell, not below it.
       *
       * This panel used to live at z-60/70/80 while the app chrome sits three
       * orders of magnitude higher: the header at z-99999, the drawer scrim at
       * 100001, the sidebar drawer at 100002. On a desktop nothing overlapped
       * and it looked fine. On a tablet, where the sidebar IS a full-height
       * drawer and the header is sticky across the top, the canvas opened
       * UNDERNEATH both — which produced three separate complaints that were
       * one bug:
       *
       *   the close X sat under the top header and could not be tapped;
       *   the sidebar printed itself over the panel and the page;
       *   the header ran across the panel from the left edge.
       *
       * A modal panel has to outrank the chrome it is covering, or the chrome
       * stays live and tappable in front of it. Same reasoning, and the same
       * band, as the drawer that already had to climb above the header. */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-100003 bg-gray-900/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Canvas */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Appearance"
        /**
         * HIDDEN MEANS HIDDEN, not merely slid off the edge.
         *
         * This panel is always mounted and animates in and out with
         * `translate-x-full`, so when it is closed it is off-screen and still
         * fully present in the accessibility tree — an `aria-modal="true"`
         * dialog that never goes away. To a screen reader that says the rest of
         * the page is inert, on every screen in the app, all the time. Its
         * controls were also still in the tab order, so a keyboard user tabbing
         * through the shop fell into a panel nobody had opened.
         *
         * Found by a browser test that asked for "the dialog" and was handed
         * two — the one it had just opened, and this.
         */
        aria-hidden={!open}
        inert={!open}
        /* `h-dvh`, never `h-screen`.
         *
         * This panel is a flex column: header, a scrolling middle, and a
         * footer holding Reset and Save. `h-screen` is `100vh`, which on a
         * tablet or phone browser is the LARGE viewport — the height the page
         * would have if the address bar were hidden. It isn't hidden. So the
         * column was laid out taller than the glass, and the part pushed past
         * the bottom edge was the footer: the merchant could change every
         * colour in the shop and had no Save to press. Nothing scrolled to
         * rescue it either — the middle is the only scroller, by design.
         *
         * `100dvh` is the height that actually exists right now, which is the
         * unit the rest of this app already uses. */
        className={`fixed right-0 top-0 z-100004 flex h-dvh w-[min(21rem,100vw)] flex-col bg-white transition-transform duration-200 dark:bg-gray-900 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-white/90">Appearance</h2>
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              Changes preview instantly. Save to apply for your shop.
            </p>
          </div>
          {/* A finger-sized way out.
           *
           * This was `p-1` around a 20px glyph — a 28px target, in the top
           * RIGHT corner of a panel pinned to the right edge of a tablet. Two
           * things were wrong with it at once: the app header used to print
           * over it (fixed above, in the z-band), and even uncovered it is well
           * under the 44px a finger actually lands on. A mouse forgives 28px;
           * a thumb at the edge of the glass does not.
           *
           * `shrink-0` because it shares a flex row with a title and a
           * sentence of help text — without it the button is the thing that
           * gives when the text is long, and it gives from 44 back down to
           * nothing. */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5"
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

        {/* shrink-0, so a long list of colour groups can never squeeze Save
            down to nothing instead of scrolling. */}
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-100 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-gray-800">
          {saveError && (
            <p className="w-full text-theme-xs text-error-500">{saveError}</p>
          )}
          <button
            type="button"
            onClick={resetAll}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-theme-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <ResetGlyph /> Reset
          </button>
          {/* Three states, three pictures. The tick was a literal "✓" inside the
              label — the same weight as the word beside it, arriving in one
              frame, on the one control whose job is to confirm that something
              happened. */}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || update.isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-theme-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            {update.isPending
              ? <><SpinnerGlyph /> Saving…</>
              : dirty && !saved
                ? <><SaveGlyph /> Save</>
                : <><CheckGlyph /> Saved</>}
          </button>
        </footer>
      </aside>
    </div>
  );
}
