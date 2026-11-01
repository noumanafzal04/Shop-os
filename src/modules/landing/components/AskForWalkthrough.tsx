/**
 * The one button that asks for attention — said once, so the header, the hero
 * and the closing band cannot drift apart on wording or destination.
 *
 * It opened a demo shop of the visitor's own until launch (2026-11-01). Now a
 * visitor asks — a walkthrough or a question — through the form at #talk, and
 * a person answers. An anchor, not a router link: from any page it lands on
 * the form, and on the landing page it scrolls there.
 */
export function AskForWalkthrough({ big = false, className = "" }: { big?: boolean; className?: string }) {
  return (
    <a
      href="/#talk"
      className={`calls-you-over relative isolate inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand-500 font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-600 ${
        big ? "px-7 py-4 text-base" : "px-5 py-2.5 text-sm"
      } ${className}`}
    >
      {/* The shine — a GRADIENT, not a slab: a sheen has no edges, so no frame
          of the animation reads as a defect. `pointer-events-none` so the
          overlay never eats the press. */}
      <span
        aria-hidden="true"
        className="shine-crosses pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />
      Ask for a walkthrough
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
