import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import { useAuthStore } from "../../../stores/authStore";
import { usePrimaryBusinessType } from "../../../common/tenant/businessType";
import {
  HELP_GROUPS,
  articlesFor,
  searchArticles,
  type HelpBlock,
} from "../content";

/** A heading's anchor id — stable, so a deep link survives a reload. */
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The Help Centre.
 *
 * Full screen, outside the dashboard shell, for the same reason the POS is:
 * somebody reads this when they are stuck, and a page wrapped in the navigation
 * they could not work out is not help. Its own header, and one way back.
 *
 * What it shows is filtered by the shop AND the reader — a restaurant is never
 * shown how to count stock, a cashier is never shown the staff screen they
 * cannot open. Help that describes a screen you do not have is worse than no
 * help, because it reads as a fault in the software.
 */
export default function HelpCenterPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const role = user?.role;
  const features = user?.tenant?.features;
  const trade = usePrimaryBusinessType();

  const isTenantSide = role === "shop_owner" || role === "staff";
  const portal = isTenantSide ? "/tenant" : "/admin";

  // Subscribed to the permission LIST, not the store's stable hasPermission
  // closure — a fresh /me changing what someone holds must re-filter.
  const can = useMemo(() => {
    return (permission: string): boolean =>
      role === "shop_owner" || role === "super_admin" || (permissions?.includes(permission) ?? false);
  }, [role, permissions]);

  const available = useMemo(
    () => articlesFor(features, trade, can),
    [features, trade, can],
  );

  const [query, setQuery] = useState("");
  const [openParents, setOpenParents] = useState<Set<string>>(new Set());
  const toggleParent = (id: string) =>
    setOpenParents((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const matches = useMemo(() => searchArticles(available, query), [available, query]);

  const activeId = params.get("topic") ?? available[0]?.id;
  const article = available.find((a) => a.id === activeId) ?? available[0];

  const select = (id: string) => {
    setParams({ topic: id });
    // Clear the anchor: a heading from the article you just left does not
    // exist in the one you just opened.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    contentRef.current?.scrollTo({ top: 0 });
  };

  const contentRef = useRef<HTMLDivElement>(null);
  const headings = (article?.body ?? []).filter((b): b is { type: "h"; text: string } => b.type === "h");

  // "On this page" tracks what is actually on screen. Without it the rail is a
  // list of links that never respond to scrolling, which reads as broken.
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  useEffect(() => {
    setActiveHeading(headings[0] ? slug(headings[0].text) : null);
    const root = contentRef.current;
    if (!root || headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible[0]) setActiveHeading(visible[0].target.id);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );

    root.querySelectorAll("[data-heading]").forEach((el) => observer.observe(el));

    // A link like ?topic=pos#taking-payment should land ON that heading, not
    // at the top of the article — the pane scrolls, not the window, so the
    // browser's own anchor handling never fires here.
    const anchor = window.location.hash.slice(1);
    if (anchor) {
      const target = root.querySelector(`#${CSS.escape(anchor)}`);
      if (target) {
        target.scrollIntoView({ block: "start" });
        setActiveHeading(anchor);
      }
    }

    return () => observer.disconnect();
  }, [article?.id, headings.length]);

  if (!article) {
    return (
      <div className="flex h-dvh items-center justify-center bg-white px-6 text-center dark:bg-gray-900">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          There are no help topics for your account yet.{" "}
          <Link to={portal} className="text-brand-500 hover:underline">Back to the portal</Link>
        </p>
      </div>
    );
  }

  // From the auth store rather than /shop/settings: that endpoint is
  // owner/staff-only and 403s for a platform admin reading the same page.
  const shopName = user?.tenant?.business_name ?? "ShopOS";
  const logoUrl = user?.tenant?.logo_url ?? null;

  return (
    /* `h-dvh` minus whatever is pinned to the bottom of the screen.
     *
     * The Help Centre runs FULL SCREEN, outside AppLayout, so the room the
     * layout reserves for the PWA install card never reaches it. A browser
     * found the card sitting on the last paragraph of every article — the one
     * place a shop is reading rather than clicking, which is exactly where a
     * banner in the way is most annoying and least likely to be reported.
     *
     * Same fix as the shop setup page, and for the same reason: a full-height
     * page has to know what is pinned below it. */
    <div className="flex h-[calc(100dvh-var(--pinned-bottom,0px))] flex-col bg-white dark:bg-gray-900">
      <PageMeta title="Help Centre | ShopOS" description="How every module works" />

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
              {shopName.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-gray-800 dark:text-white/90">
              {shopName}
            </span>
            <span className="block text-theme-xs text-brand-500 dark:text-brand-400">Help Centre</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate(portal)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-300 px-4 py-2.5 text-theme-sm font-semibold text-gray-700 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600 dark:border-gray-700 dark:text-gray-200 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400"
        >
          Back to portal
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 17 17 7M17 7H9m8 0v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Topics ───────────────────────────────────────────── */}
        <nav className="hidden w-60 shrink-0 overflow-y-auto border-r border-gray-200 px-2.5 py-4 dark:border-gray-800 lg:block">
          <label className="relative mb-5 block">
            <span className="sr-only">Search help</span>
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              viewBox="0 0 24 24" fill="none" aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 dark:border-gray-800 dark:bg-gray-800/50 dark:text-white/90"
            />
          </label>

          {matches.length === 0 && (
            <p className="px-1 text-theme-sm text-gray-500 dark:text-gray-400">
              Nothing matches “{query}”.
            </p>
          )}

          {HELP_GROUPS.map((group) => {
            const inGroup = matches.filter((a) => a.group === group);
            if (inGroup.length === 0) return null;

            // Children render UNDER their parent, never as siblings — forty
            // flat screens is a list nobody reads. When a search matches only
            // a child, its parent is pulled in so the child has somewhere to
            // hang rather than vanishing.
            const parents = inGroup.filter((a) => !a.parent);
            const orphaned = inGroup.filter(
              (a) => a.parent && !parents.some((p) => p.id === a.parent),
            );
            const roots = [
              ...parents,
              ...orphaned
                .map((o) => available.find((a) => a.id === o.parent))
                .filter((a): a is NonNullable<typeof a> => !!a)
                .filter((a, i, xs) => xs.indexOf(a) === i),
            ];

            return (
              <div key={group} className="mb-5">
                <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {group}
                </p>
                <ul>
                  {roots.map((a) => {
                    const children = available.filter((c) => c.parent === a.id);
                    const shownChildren = children.filter(
                      (c) => matches.includes(c) || matches.includes(a),
                    );
                    const isOpen =
                      openParents.has(a.id) ||
                      a.id === article.id ||
                      children.some((c) => c.id === article.id);

                    return (
                      <li key={a.id}>
                        <div className="flex items-stretch">
                          <button
                            type="button"
                            onClick={() => select(a.id)}
                            aria-current={a.id === article.id ? "page" : undefined}
                            className={`flex-1 truncate rounded-lg px-2 py-1.5 text-left text-theme-sm transition-colors ${
                              a.id === article.id
                                ? "bg-brand-50 font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100"
                            }`}
                          >
                            {a.title}
                          </button>
                          {shownChildren.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleParent(a.id)}
                              aria-label={isOpen ? `Collapse ${a.title}` : `Expand ${a.title}`}
                              aria-expanded={isOpen}
                              className="ml-0.5 rounded-lg px-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
                            >
                              <svg
                                width="14" height="14" viewBox="0 0 24 24" fill="none"
                                className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
                              >
                                <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {isOpen && shownChildren.length > 0 && (
                          <ul className="ml-3 border-l border-gray-200 dark:border-gray-800">
                            {shownChildren.map((c) => (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  onClick={() => select(c.id)}
                                  aria-current={c.id === article.id ? "page" : undefined}
                                  className={`-ml-px block w-full truncate border-l-2 py-1.5 pl-3 pr-2 text-left text-theme-sm transition-colors ${
                                    c.id === article.id
                                      ? "border-brand-500 font-semibold text-brand-600 dark:text-brand-400"
                                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                                  }`}
                                >
                                  {c.title}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* ── Article ──────────────────────────────────────────── */}
        <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto">
          <article className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6">
            <p className="mb-2 text-theme-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
              {article.group}
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white/90 sm:text-4xl">
              {article.title}
            </h1>
            <p className="mt-3 text-base text-gray-500 dark:text-gray-400">{article.summary}</p>

            {/* Only offered when the reader can actually open it — the same
                check that decided they may read this article at all. */}
            {article.screen && (
              <Link
                to={article.screen}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-theme-sm font-semibold text-white transition-colors hover:bg-brand-600"
              >
                Open this screen
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            )}

            <div className="mt-8 space-y-5">
              {article.body.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </div>

            <p className="mt-14 border-t border-gray-200 pt-5 text-theme-xs text-gray-400 dark:border-gray-800">
              Still stuck? Your shop owner can see more than you can — ask them first.
            </p>
          </article>
        </div>

        {/* ── On this page ─────────────────────────────────────── */}
        {headings.length > 1 && (
          <aside className="hidden w-52 shrink-0 overflow-y-auto px-4 py-8 xl:block">
            <p className="mb-3 text-theme-xs font-semibold uppercase tracking-wider text-gray-400">
              On this page
            </p>
            <ul className="space-y-1 border-l border-gray-200 dark:border-gray-800">
              {headings.map((h) => {
                const id = slug(h.text);
                return (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        contentRef.current
                          ?.querySelector(`#${CSS.escape(id)}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        window.history.replaceState(null, "", `#${id}`);
                        setActiveHeading(id);
                      }}
                      className={`-ml-px block border-l-2 py-1 pl-4 text-theme-sm transition-colors ${
                        activeHeading === id
                          ? "border-brand-500 font-medium text-brand-600 dark:text-brand-400"
                          : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                      }`}
                    >
                      {h.text}
                    </a>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}

function Block({ block }: { block: HelpBlock }) {
  switch (block.type) {
    case "h":
      return (
        <h2
          id={slug(block.text)}
          data-heading
          className="scroll-mt-6 pt-4 text-xl font-semibold tracking-tight text-gray-900 dark:text-white/90"
        >
          {block.text}
        </h2>
      );

    case "p":
      return <p className="text-base leading-relaxed text-gray-600 dark:text-gray-300">{block.text}</p>;

    case "steps":
      return (
        <ol className="space-y-3">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-base leading-relaxed text-gray-600 dark:text-gray-300">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-theme-xs font-semibold text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                {i + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      );

    case "list":
      return (
        <ul className="space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-base leading-relaxed text-gray-600 dark:text-gray-300">
              <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );

    case "keys":
      return (
        <dl className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {block.items.map(([key, what]) => (
            <div key={key} className="flex items-center gap-4 px-4 py-2.5">
              <dt className="w-16 shrink-0">
                <kbd className="rounded-md border border-gray-300 bg-gray-50 px-2 py-1 font-sans text-theme-xs font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  {key}
                </kbd>
              </dt>
              <dd className="text-theme-sm text-gray-600 dark:text-gray-300">{what}</dd>
            </div>
          ))}
        </dl>
      );

    case "table":
      return (
        // Wide content scrolls inside its own box; the page never scrolls sideways.
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03]">
                {block.head.map((h) => (
                  <th key={h} className="px-4 py-2.5 text-theme-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-4 py-2.5 align-top text-theme-sm ${
                        j === 0
                          ? "font-medium text-gray-800 dark:text-gray-100"
                          : "text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "note":
      return (
        <p className="rounded-xl border-l-4 border-brand-400 bg-brand-50/60 px-4 py-3 text-theme-sm leading-relaxed text-gray-700 dark:bg-brand-500/10 dark:text-gray-200">
          {block.text}
        </p>
      );

    case "warn":
      return (
        <p className="rounded-xl border-l-4 border-warning-500 bg-warning-50 px-4 py-3 text-theme-sm leading-relaxed text-gray-700 dark:bg-warning-500/10 dark:text-gray-200">
          {block.text}
        </p>
      );
  }
}
