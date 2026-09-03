import { useCallback, useEffect, useMemo, useState } from "react";

import PageMeta from "../../../components/common/PageMeta";
import { FULL_SCREEN_PAGE_MIN } from "../../../layout/fullScreenPage";
import { QA_INTRO, QA_SECTIONS } from "../content";
import type { QaStep } from "../types";

/**
 * THE QA WALKTHROUGH.
 *
 * ── Why it is a walk and not a document ─────────────────────────────────
 *
 * A tester handed a forty-page document reads the first two pages and then
 * clicks around. What actually gets a product tested is ONE thing on screen at
 * a time, in an order somebody decided, with a way forward — so this is Next
 * and Previous over a fixed path, and the path is the order a shop lives in:
 * sign in, get a catalog, put stock in it, sell it, count the drawer, close the
 * day, read the reports.
 *
 * ── Why it is separate from the Help Centre ─────────────────────────────
 *
 * The Help Centre is filtered to what THIS shop has, which is exactly right for
 * a shopkeeper and useless for a tester: the parts a shop switched off are
 * precisely the parts somebody has to check are properly off. So this shows
 * everything, always, and says which module each thing needs instead of hiding
 * it.
 *
 * ── The tick boxes ──────────────────────────────────────────────────────
 *
 * Kept in this browser only. A tester's own place-marker, not a record anybody
 * else reads — a QA pass that reported itself complete would be a claim, and
 * this file is careful not to make claims on somebody else's behalf.
 */

const DONE_KEY = "cartze-qa-walked";

type Marks = Record<string, "done" | "problem">;

function readMarks(): Marks {
  try {
    const raw = localStorage.getItem(DONE_KEY);

    return raw === null ? {} : (JSON.parse(raw) as Marks);
  } catch {
    // A half-written value must never stop the walkthrough opening.
    return {};
  }
}

const REQUIRED_WORDS: Record<QaStep["required"], string> = {
  always: "Every shop has this",
  optional: "Optional — a shop can run without it",
  module: "Only when its module is on",
  trade: "Only for the trades named",
};

export default function QaFlowPage() {
  // One flat path. The sections are how it is grouped for the rail; Next and
  // Previous walk straight through them.
  const path = useMemo(
    () => QA_SECTIONS.flatMap((section) => section.steps.map((step) => ({ section, step }))),
    [],
  );

  // -1 is the introduction, which is not a step: it is what a tester has to
  // read before any of them make sense.
  const [at, setAt] = useState(-1);
  const [marks, setMarks] = useState<Marks>(() => readMarks());

  const total = path.length;
  const current = at >= 0 ? path[at] : null;

  const go = useCallback(
    (to: number) => {
      setAt(Math.max(-1, Math.min(total - 1, to)));
      window.scrollTo({ top: 0 });
    },
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while somebody is typing a note into a field somewhere.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") go(at + 1);
      if (e.key === "ArrowLeft") go(at - 1);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [at, go]);

  const mark = (id: string, value: "done" | "problem") => {
    const next: Marks = { ...marks };
    if (next[id] === value) delete next[id];
    else next[id] = value;
    setMarks(next);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(next));
    } catch {
      // Out of space, or a browser that refuses. The walkthrough still works;
      // only the place-marker is lost, and it was never the point.
    }
  };

  const walked = Object.values(marks).filter((m) => m === "done").length;
  const problems = Object.values(marks).filter((m) => m === "problem").length;

  return (
    // Outside AppLayout, so it makes its own room for whatever is pinned to
    // the bottom of the window — the install prompt sits there, and a page that
    // is exactly the height of the viewport has no scroll room to recover with.
    <div className={`${FULL_SCREEN_PAGE_MIN} bg-gray-50 dark:bg-gray-950`}>
      <PageMeta title="QA walkthrough — CartZe" description="One pass through the whole product, in the order a shop lives it." />

      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-gray-800 dark:text-white/90">QA walkthrough</h1>
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              {at < 0 ? "Start here" : `Step ${at + 1} of ${total} · ${current?.section.title}`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3 text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
            <span>{walked} walked</span>
            {problems > 0 && <span className="font-medium text-error-500">{problems} to report</span>}
          </div>
        </div>
        {/* How far through, without asking anybody to count. */}
        <div className="h-1 w-full bg-gray-200 dark:bg-gray-800">
          <div
            className="h-1 bg-brand-500 transition-all"
            style={{ width: `${at < 0 ? 0 : ((at + 1) / total) * 100}%` }}
          />
        </div>
      </header>

      {/* Room at the bottom for whatever is pinned there — the install card
          sits at `bottom-3` over everything. A minimum HEIGHT was not enough:
          the page's own last row still ended at the true bottom of the
          document, so on a phone "← Previous" sat under the card with nowhere
          left to scroll. AppLayout pads by the same variable for the same
          reason; a full-screen page has to do it for itself. */}
      <div className="mx-auto grid max-w-6xl gap-6 px-5 pb-[calc(1.5rem+var(--pinned-bottom,0px))] pt-6 lg:grid-cols-[220px_1fr]">
        {/* The rail: where you are in the whole thing, and a way to jump. */}
        <nav className="hidden lg:block">
          <ol className="sticky top-28 space-y-1">
            <li>
              <button
                type="button"
                onClick={() => go(-1)}
                className={`w-full rounded-lg px-3 py-2 text-left text-theme-sm ${
                  at < 0
                    ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                    : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
                }`}
              >
                What you are testing
              </button>
            </li>
            {QA_SECTIONS.map((section) => {
              const first = path.findIndex((p) => p.section.id === section.id);
              const inHere = current?.section.id === section.id;

              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => go(first)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-theme-sm ${
                      inHere
                        ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                        : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
                    }`}
                  >
                    {section.title}
                    <span className="ml-1 text-theme-xs text-gray-400">({section.steps.length})</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="min-w-0">
          {current === null ? <Intro /> : <Step key={current.step.id} step={current.step} section={current.section.title} blurb={current.section.blurb} />}

          {current !== null && (
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => mark(current.step.id, "done")}
                className={`rounded-lg border px-3 py-2 text-theme-sm font-medium ${
                  marks[current.step.id] === "done"
                    ? "border-success-500 bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-400"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                }`}
              >
                ✓ Walked this
              </button>
              <button
                type="button"
                onClick={() => mark(current.step.id, "problem")}
                className={`rounded-lg border px-3 py-2 text-theme-sm font-medium ${
                  marks[current.step.id] === "problem"
                    ? "border-error-500 bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-400"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                }`}
              >
                ⚑ Found a problem
              </button>
            </div>
          )}

          {/* Next and Previous, at the bottom where a reader ends up, and on the
              arrow keys because a tester has one hand on the keyboard. */}
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-800">
            <button
              type="button"
              onClick={() => go(at - 1)}
              disabled={at < 0}
              className="rounded-lg border border-gray-300 px-4 py-2 text-theme-sm font-medium text-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            >
              ← Previous
            </button>
            <span className="text-theme-xs text-gray-400">Arrow keys work too</span>
            <button
              type="button"
              onClick={() => go(at + 1)}
              disabled={at >= total - 1}
              className="rounded-lg bg-brand-500 px-4 py-2 text-theme-sm font-medium text-white disabled:opacity-40 hover:bg-brand-600"
            >
              Next →
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      {children}
    </section>
  );
}

function Intro() {
  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">{QA_INTRO.title}</h2>
        {QA_INTRO.lines.map((line) => (
          <p key={line} className="mt-3 text-theme-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {line}
          </p>
        ))}
      </Card>

      <Card>
        <h3 className="font-semibold text-gray-800 dark:text-white/90">
          Three things decide what anybody sees
        </h3>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          Learn these before you open a screen. They explain most of what looks missing.
        </p>
        <dl className="mt-4 space-y-3">
          {QA_INTRO.axes.map((axis) => (
            <div key={axis.name} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <dt className="text-theme-xs font-semibold uppercase tracking-wide text-brand-500">{axis.name}</dt>
              <dd className="mt-1 text-theme-sm text-gray-600 dark:text-gray-300">{axis.text}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <h3 className="font-semibold text-gray-800 dark:text-white/90">Before you report anything</h3>
        <ul className="mt-3 space-y-2">
          {QA_INTRO.before.map((line) => (
            <li key={line} className="flex gap-2 text-theme-sm text-gray-600 dark:text-gray-300">
              <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Step({ step, section, blurb }: { step: QaStep; section: string; blurb: string }) {
  return (
    <div className="space-y-5">
      <Card>
        <p className="text-theme-xs font-medium uppercase tracking-wide text-gray-400">{section}</p>
        <h2 className="mt-1 text-xl font-semibold text-gray-800 dark:text-white/90">{step.title}</h2>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">{step.summary}</p>

        <div className="mt-4 flex flex-wrap gap-2 text-theme-xs">
          {step.screen && (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600 dark:bg-white/5 dark:text-gray-300">
              {step.screen}
            </span>
          )}
          {step.module && (
            <span className="rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
              needs the {step.module} module
            </span>
          )}
          {step.trades && (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600 dark:bg-white/5 dark:text-gray-300">
              {step.trades.join(" · ")} only
            </span>
          )}
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-500 dark:bg-white/5 dark:text-gray-400">
            {REQUIRED_WORDS[step.required]}
          </span>
        </div>

        <p className="mt-4 border-l-2 border-gray-200 pl-3 text-theme-xs italic text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {blurb}
        </p>
      </Card>

      <Card>
        <h3 className="font-semibold text-gray-800 dark:text-white/90">What this is, and why it exists</h3>
        <div className="mt-3 space-y-3">
          {step.what.map((line) => (
            <p key={line} className="text-theme-sm leading-relaxed text-gray-600 dark:text-gray-300">
              {line}
            </p>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-gray-800 dark:text-white/90">Walk it</h3>
        <ol className="mt-3 space-y-3">
          {step.checks.map((check, i) => (
            <li key={check.do} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{check.do}</p>
                  <p className="mt-1 text-theme-sm text-gray-600 dark:text-gray-300">
                    <span className="font-medium text-success-600 dark:text-success-500">Expect: </span>
                    {check.expect}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {step.wrong && (
        <Card>
          <h3 className="font-semibold text-error-600 dark:text-error-400">What a real failure looks like here</h3>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            These are bugs, not rules. Everything else on this page may be the product working as designed.
          </p>
          <ul className="mt-3 space-y-2">
            {step.wrong.map((line) => (
              <li key={line} className="flex gap-2 text-theme-sm text-gray-700 dark:text-gray-200">
                <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-error-500" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
