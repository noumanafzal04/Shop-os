import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { homeForRole } from "../../../common/routing/guards";
import { Wordmark } from "../../../components/brand/Brand";
import { useAuthStore } from "../../../stores/authStore";
import { TryDemo } from "./TryDemo";

/**
 * The sections a visitor can be taken to.
 *
 * SHORT AND ALL THE SAME SHAPE. They used to be a mixture — "Why it is
 * different" beside "Trades" beside "What is inside" — and a row where one item
 * is a sentence and the next is a single word cannot be scanned: the eye has to
 * read every one to find out how long it is. Every label here is one or two
 * words and names a thing, not a question.
 */
const LINKS: Array<{ id: string; label: string }> = [
  { id: "offline", label: "Why CartZe" },
  { id: "trades", label: "Trades" },
  { id: "inside", label: "Features" },
  { id: "pricing", label: "Pricing" },
  { id: "talk", label: "Contact" },
];

/**
 * THE ONE ITEM IN THE NAV THAT LEAVES THE PAGE.
 *
 * Marketplace is a destination, not a section: it goes straight to `/shops`.
 *
 * Kept out of LINKS because every entry there is an in-page anchor watched by
 * the section observer, and a route link has no section to observe — put in
 * that list it would simply never light, which reads as a broken menu item
 * rather than as a different KIND of item. So it gets its own treatment: a
 * real Link, marked with the brand instead of with the "you are here" pill.
 *
 * The landing page no longer carries a marketplace SECTION of its own. It had
 * one — a live row of real products from real shops — and it was moved out: the
 * aisle belongs on the market side, where somebody has gone to shop, and a
 * landing page written for a shopkeeper deciding whether to buy the software is
 * not the place to sell them a bag of rice. This link is now the only way the
 * marketplace appears here, which is what a destination should be.
 */
const STOREFRONT = { to: "/shops", label: "Marketplace" };

/**
 * THE HEADER, INCLUDING FOR SOMEBODY WHO ALREADY HAS A SHOP.
 *
 * A landing page is written for strangers, and this one used to behave as
 * though everyone reaching it was one. But the base url is what people type,
 * what a bookmark holds and where a browser goes when the tab is reopened — so
 * a shopkeeper who signed in yesterday lands here, and was shown "Sign in" as
 * if the product had never met them. Worse, "Try the demo" was the loudest
 * thing on the page for somebody who had already bought it.
 *
 * So when there is a session, the header greets them by name and its main
 * button opens THEIR shop — the admin panel, the till, or the storefront,
 * whichever their role calls home.
 *
 * ── The links are one object, not five ─────────────────────────────────
 *
 * They sat bare on the band, evenly spaced, with nothing holding them
 * together, which on a dark hero reads as five pieces of stray text rather
 * than as a menu. They live in a pill now, and the section you are actually
 * looking at is marked inside it — a page this long is one you get lost in,
 * and the header is the only thing that can say where you are.
 */
export function SiteHeader({ overDark = false }: { overDark?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [here, setHere] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);

  /**
   * HOW TALL THIS HEADER IS, published as `--landing-header`.
   *
   * The hero slides up underneath it so the band's own gradient and grid run
   * behind the links — a flat bar sitting on a gradient shows a seam straight
   * across the top of the page, which is what a visitor reads as the design
   * being cut.
   *
   * That was first done with `-mt-[62px]`: this header's height, measured once
   * by hand. It became 79px the moment the nav grew a pill, and the difference
   * showed as a strip of the white page above the dark hero. So it is measured
   * now, and re-measured whenever the header changes size — a longer name in
   * the greeting, a wrapped nav, a different font.
   *
   * `useLayoutEffect` because the value has to be there before the browser
   * paints; in an effect the hero starts below the header for one frame and
   * then jumps up.
   */
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;

    const publish = () =>
      document.documentElement.style.setProperty("--landing-header", `${el.offsetHeight}px`);

    publish();
    if (typeof ResizeObserver === "undefined") return;

    const watch = new ResizeObserver(publish);
    watch.observe(el);

    return () => {
      watch.disconnect();
      document.documentElement.style.removeProperty("--landing-header");
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // WHICH SECTION IS IN FRONT OF YOU. An observer rather than a scroll
  // handler, for the reason `useSettlesIn` gives: a scroll listener runs on
  // every frame of every scroll to answer a question that changes five times.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const sections = LINKS
      .map((l) => document.getElementById(l.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // AN OBSERVER REPORTS CHANGES, NOT STATE. Reading only the entries it
    // hands you means the last section to be in the band keeps the mark
    // forever — scroll to the very top, where none of these sections is in
    // front of you, and "Trades" stayed lit. So the whole picture is kept
    // here and the answer is worked out from all of it.
    const inBand = new Map<string, boolean>();

    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) inBand.set(entry.target.id, entry.isIntersecting);

        const showing = sections.filter((el) => inBand.get(el.id));
        // Nothing tracked is in front of you — the hero, or the footer. That
        // is a real answer, and it is "nowhere in particular".
        if (showing.length === 0) return setHere(null);

        // The one nearest the top of the window, so a tall section does not
        // keep the mark while the next one is what you are reading.
        const top = showing.reduce((best, el) =>
          el.getBoundingClientRect().top < best.getBoundingClientRect().top ? el : best);
        setHere(top.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    sections.forEach((el) => seen.observe(el));

    return () => seen.disconnect();
  }, []);

  // The first word of a name is what a person is called. "Muhammad Bilal
  // Ahmed" greeted in full reads like a letter from a bank.
  const firstName = user?.name?.trim().split(/\s+/)[0];

  // OVER A DARK BAND, IN BOTH THEMES. The hero is near-black whichever theme
  // the visitor is in, so at the top of the page the header's own colours are
  // wrong in light mode — grey-600 links on near-black is a header nobody can
  // read. It borrows light text until it has scrolled off the band.
  const onDark = overDark && !scrolled;

  const pill = onDark
    ? "border-white/12 bg-white/[0.06]"
    : "border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5";
  const linkIdle = onDark
    ? "text-white/65 hover:text-white"
    : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white";
  const linkHere = onDark
    ? "bg-white/12 text-white"
    : "bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white";
  const quiet = onDark
    ? "text-white/70 hover:bg-white/10 hover:text-white"
    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white";

  return (
    <header
      ref={bar}
      /* TRANSPARENT over the hero, so the band's own gradient and grid are what
         you see behind the links. The hero is pulled up under it by exactly
         `--landing-header`, published above.

         It stays a direct child of the page, which matters: wrapping it and
         the hero in one dark box also removed the seam, and broke `sticky` —
         a sticky element holds inside its own parent, so past the hero the
         header scrolled away with the box. Measured, not assumed: at 2400px
         down its top was -1010px. */
      className={`sticky top-0 z-50 border-b transition-colors duration-300 ${
        scrolled
          ? "border-gray-200/50 bg-white/45 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.08] dark:bg-gray-950/45"
          : "border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3.5 sm:px-8">
        {/* THE REAL MARK, not the word typed again.
            `Brand.tsx` exists because the wordmark used to be three SVG files
            that were forever one edit apart — an SVG in an <img> is its own
            document and inherits neither the font nor the theme. */}
        <Link to="/" aria-label="CartZe home" className="shrink-0">
          <Wordmark size={30} tone={onDark ? "onDark" : "auto"} />
        </Link>

        {/* Centred and absolutely balanced: `flex-1` on both outer groups
            would move the pill every time the right-hand side changed width,
            which it does the moment somebody signs in. */}
        <div className={`mx-auto hidden items-center gap-1 rounded-full border p-1.5 backdrop-blur lg:flex ${pill}`}>
          {LINKS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={here === item.id ? "true" : undefined}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                here === item.id ? linkHere : linkIdle
              }`}
            >
              {item.label}
            </a>
          ))}
          {/* Marked as the destination it is: a filled pill inside the pill,
              with a ring growing out of its border. See `ring-expands`. */}
          <Link
            to={STOREFRONT.to}
            className={`ring-expands relative isolate rounded-full px-4 py-2 text-sm font-semibold transition ${
              onDark
                ? "bg-brand-500 text-white hover:bg-brand-400"
                : "bg-brand-500 text-white shadow-sm shadow-brand-500/25 hover:bg-brand-600"
            }`}
          >
            {STOREFRONT.label}
          </Link>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          {user ? (
            <>
              <span className={`hidden text-sm sm:inline ${onDark ? "text-white/60" : "text-gray-500 dark:text-gray-400"}`}>
                Salam,{" "}
                <span className={onDark ? "font-semibold text-white" : "font-semibold text-gray-800 dark:text-white"}>
                  {firstName}
                </span>
              </span>
              <Link
                to={homeForRole(user.role)}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
              >
                Open my shop
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
                  <path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/signin"
                className={`hidden rounded-xl px-4 py-2.5 text-sm font-medium transition sm:inline-block ${quiet}`}
              >
                Sign in
              </Link>
              <TryDemo />
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className={`rounded-xl p-2.5 transition lg:hidden ${quiet}`}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
              {open ? (
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {/* The small-screen menu. It closes on choosing, because a menu still
          covering the thing you just asked for is a menu you dismiss twice. */}
      {open && (
        <div
          id="site-menu"
          className="border-t border-gray-200 bg-white px-4 py-3 lg:hidden dark:border-white/10 dark:bg-gray-950"
        >
          {LINKS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => setOpen(false)}
              className={`flex min-h-12 items-center rounded-xl px-4 text-[15px] font-medium transition ${
                here === item.id
                  ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"
                  : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5"
              }`}
            >
              {item.label}
            </a>
          ))}
          <Link
            to={STOREFRONT.to}
            onClick={() => setOpen(false)}
            className="mt-1 flex min-h-12 items-center justify-center rounded-xl bg-brand-500 px-4 text-[15px] font-semibold text-white transition hover:bg-brand-600"
          >
            {STOREFRONT.label}
          </Link>
          {!user && (
            <Link
              to="/signin"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center rounded-xl px-4 text-[15px] font-medium text-gray-700 transition hover:bg-gray-100 sm:hidden dark:text-gray-200 dark:hover:bg-white/5"
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
