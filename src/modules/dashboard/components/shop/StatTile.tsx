import { Link } from "react-router";

import { AngleRightIcon } from "../../../../icons";
import { TONE_GROUND, TONE_HOVER, TONE_TEXT, type Tone } from "./tone";

interface StatTileProps {
  label: string;
  value: string;
  caption?: string;
  tone: Tone;
  /** Present when the figure has a screen behind it — the tile then IS the link. */
  to?: string;
}

/**
 * The counter tile used inside every panel — stock, the till, the floor, the
 * dispensary. One tile, one set of tones (see tone.ts).
 */
export function StatTile({ label, value, caption, tone, to }: StatTileProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p
          className={`truncate text-2xl font-bold tabular-nums tracking-tight ${TONE_TEXT[tone]}`}
          title={value}
        >
          {value}
        </p>
        {to && (
          // Only a tile you can walk through gets the affordance.
          <AngleRightIcon className="mt-1.5 size-4 shrink-0 text-gray-500 opacity-0 transition-all duration-200 group-hover/tile:translate-x-0.5 group-hover/tile:opacity-100 dark:text-gray-400" />
        )}
      </div>
      <p className="mt-1 truncate text-theme-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
      {caption && (
        <p className="mt-0.5 truncate text-theme-xs text-gray-500 dark:text-gray-400" title={caption}>
          {caption}
        </p>
      )}
    </>
  );

  const shell = `group/tile block rounded-xl p-4 ring-1 transition-colors ${TONE_GROUND[tone]}`;

  return to ? (
    <Link to={to} className={`${shell} ${TONE_HOVER[tone]}`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
