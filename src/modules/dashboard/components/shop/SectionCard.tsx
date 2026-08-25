import type { ReactNode } from "react";

import { Surface, SurfaceEmpty, SurfacePulse } from "../Surface";

interface SectionCardProps {
  title: string;
  subtitle?: string;
  /**
   * A glyph for the card's header chip. Panels that carry one read as a set
   * with the KPI strip above them, which is the only reason it exists.
   */
  icon?: ReactNode;
  /** "View All" target. Omitted when the tenant has no such screen. */
  to?: string;
  toLabel?: string;
  /** Set for tables, which supply their own edge-to-edge padding. */
  flush?: boolean;
  children: ReactNode;
}

/**
 * The rounded card every shop-dashboard panel sits in.
 *
 * A shell over `Surface`, which the platform console's `Panel` also renders.
 * The two used to be separate copies of one design and had already drifted —
 * different padding, and different BREAKPOINTS for it, so between 640px and
 * 768px the two consoles looked like two products. This wrapper survives only
 * to keep the `to` / `toLabel` prop shape its forty call sites use.
 */
export function SectionCard({
  title,
  subtitle,
  icon,
  to,
  toLabel = "View All",
  flush,
  children,
}: SectionCardProps) {
  return (
    <Surface
      title={title}
      subtitle={subtitle}
      icon={icon}
      action={to ? { label: toLabel, to } : undefined}
      flush={flush}
    >
      {children}
    </Surface>
  );
}

/** Honest "there is nothing here yet" copy — never a fabricated sample row. */
export function EmptyPanel({ message, hint }: { message: string; hint?: string }) {
  return <SurfaceEmpty message={message} hint={hint} />;
}

/** Pulsing bar used to build skeletons that match the real layout. */
export function SkeletonBar({ className = "h-4 w-full" }: { className?: string }) {
  return <SurfacePulse className={className} />;
}

/**
 * A panel-shaped placeholder. The loaded page always draws at least one card
 * below the strip (Attention needed has no module gate), so leaving this out
 * made the whole page jump upward the moment the payload landed.
 */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="flex items-center gap-3">
        <SkeletonBar className="size-9 rounded-xl" />
        <SkeletonBar className="h-4 w-36" />
      </div>
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBar key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </section>
  );
}
