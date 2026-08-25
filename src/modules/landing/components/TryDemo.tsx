import { Link } from "react-router";

/**
 * The one button that asks for attention — said once, so the header, the hero
 * and the closing band cannot drift apart on wording or destination.
 */
export function TryDemo({ big = false, className = "" }: { big?: boolean; className?: string }) {
  return (
    <Link
      to="/demo"
      className={`calls-you-over relative isolate inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand-500 font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-600 ${
        big ? "px-7 py-4 text-base" : "px-5 py-2.5 text-sm"
      } ${className}`}
    >
      {/* The shine — a GRADIENT, not a slab.
          A solid band was the first version, and a still of the page caught it
          parked over the button looking like a rendering fault. A sheen has no
          edges, so there is no frame of the animation that reads as a defect.

          `pointer-events-none` because an overlay that eats the press on a
          call to action is a defect this codebase has already met on the
          till. */}
      <span
        aria-hidden="true"
        className="shine-crosses pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />
      Try the demo
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
