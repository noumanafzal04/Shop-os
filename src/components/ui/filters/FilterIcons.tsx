/**
 * The handful of glyphs the filter bar needs, drawn on a 24 grid at
 * `currentColor` so a pill's icon takes the pill's own state colour without
 * anything being passed down.
 *
 * Local to the filter kit rather than added to `src/icons`: that set is the
 * app's navigation vocabulary, and a magnifier that only ever appears inside a
 * search field does not belong in it.
 */
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SearchGlyph({ className = "size-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" {...stroke} />
      <path d="M15.6 15.6 20 20" {...stroke} />
    </svg>
  );
}

export function FunnelGlyph({ className = "size-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 6h16l-6.2 7.1v5.2l-3.6 1.9v-7.1z" {...stroke} />
    </svg>
  );
}

export function CalendarGlyph({ className = "size-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" {...stroke} />
      <path d="M3.5 9.6h17M8.3 3.5v3M15.7 3.5v3" {...stroke} />
    </svg>
  );
}

export function TickGlyph({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" {...stroke} strokeWidth={2} />
    </svg>
  );
}

export function CrossGlyph({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" {...stroke} strokeWidth={2} />
    </svg>
  );
}

export function CaretGlyph({ className = "size-3.5", up = false }: { className?: string; up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} transition-transform ${up ? "rotate-180" : ""}`} aria-hidden="true">
      <path d="m6 9.5 6 6 6-6" {...stroke} strokeWidth={2} />
    </svg>
  );
}

export function ArrowGlyph({ className = "size-4", left = false }: { className?: string; left?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} ${left ? "rotate-180" : ""}`} aria-hidden="true">
      <path d="M4.5 12h15M13.5 6l6 6-6 6" {...stroke} />
    </svg>
  );
}

export function ChevronGlyph({ className = "size-4", left = false }: { className?: string; left?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} ${left ? "rotate-180" : ""}`} aria-hidden="true">
      <path d="m9.5 6 6 6-6 6" {...stroke} strokeWidth={2} />
    </svg>
  );
}
