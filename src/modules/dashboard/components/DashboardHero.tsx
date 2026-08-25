import type { ReactNode } from "react";

/**
 * THE BAND AT THE TOP OF BOTH CONSOLES.
 *
 * It was a white card with a small tinted wash in one corner — the same white
 * as the twenty cards under it, so the page opened with no clear top and the
 * first KPI tile became the masthead by accident.
 *
 * It is a brand band now, and that is a deliberate borrow from the product's
 * own front page: the landing hero is a dark room with one lit counter in it,
 * and a shopkeeper who signs in should land somewhere that looks like the place
 * they were just sold. One colour, used once per screen, at the only point on
 * the page where colour is not competing with a figure.
 *
 * Everything below it stays white. That is the whole reason this works — a
 * coloured band is a masthead; a coloured page is a novelty.
 */
interface Chip {
  label: string;
  value: string;
  /** Only for the semantic three. Everything else rides the band's own tint. */
  tone?: "good" | "bad" | "plain";
}

interface Props {
  /** Small line above the title — a greeting, or whose console this is. */
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Two letters. A mark, not an avatar upload. */
  initials?: string;
  icon?: ReactNode;
  chips?: Chip[];
  /** Skeleton chips, sized like the real ones so the band cannot grow a row. */
  loadingChips?: number;
  /** Anything else the band should carry — the shop's branch pill. */
  aside?: ReactNode;
}

const CHIP_TONE: Record<NonNullable<Chip["tone"]>, string> = {
  good: "bg-success-400/20 text-success-100 ring-success-300/30",
  bad: "bg-error-400/20 text-error-100 ring-error-300/30",
  plain: "bg-white/12 text-white ring-white/20",
};

export function DashboardHero({
  eyebrow,
  title,
  subtitle,
  initials,
  icon,
  chips,
  loadingChips = 0,
  aside,
}: Props) {
  return (
    <header className="relative mb-5 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white shadow-lg shadow-brand-900/20 md:mb-6 sm:p-7">
      {/* Two soft lights and a faint grid — the same treatment as the front
          page's hero, so the two read as one product. Decorative throughout. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="absolute -right-24 -top-28 size-72 rounded-full bg-white/10 blur-3xl" />
        <span className="absolute -bottom-32 left-1/4 size-64 rounded-full bg-brand-300/20 blur-3xl" />
        <span className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:44px_44px]" />
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          {(initials || icon) && (
            <span className="flex size-13 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-theme-xl font-bold text-white ring-1 ring-white/25 backdrop-blur sm:size-14">
              {initials ?? icon}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-theme-xs font-semibold uppercase tracking-[0.14em] text-white/60">
              {eyebrow}
            </p>
            <h2 className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-[1.75rem]">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-theme-sm text-white/65">{subtitle}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {aside}
          {chips?.map((chip) => (
            <span
              key={chip.label}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-theme-xs font-semibold ring-1 backdrop-blur ${
                CHIP_TONE[chip.tone ?? "plain"]
              }`}
            >
              {chip.label}
              <span className="tabular-nums">{chip.value}</span>
            </span>
          ))}
          {!chips &&
            Array.from({ length: loadingChips }).map((_, i) => (
              // Same size as the real chip, so the band does not gain a row on
              // a narrow screen the moment the payload lands.
              <span key={i} className="h-8 w-28 animate-pulse rounded-full bg-white/15" />
            ))}
        </div>
      </div>
    </header>
  );
}
