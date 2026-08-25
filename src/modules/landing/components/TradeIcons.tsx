/**
 * ONE ICON PER TRADE, DRAWN HERE.
 *
 * Authored rather than pulled from a set, for two reasons. A shopkeeper picks
 * their trade off this row and has to recognise it in about a second — a
 * generic "store" glyph eight times over is a row nobody can read. And an icon
 * font or a CDN sprite is a network request between a visitor and the first
 * thing they came to see.
 *
 * All on one 24-grid with the same 1.6 stroke, so eight different subjects
 * still read as one family. `currentColor` throughout: the card decides the
 * colour, and dark mode needs no second copy.
 */
type Props = { className?: string };

const base = (className?: string) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: className ?? "h-6 w-6",
  "aria-hidden": true,
});

/** A cloche — the plate that arrives at a table. */
export const FoodIcon = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 17h18" />
    <path d="M4.5 17a7.5 7.5 0 0 1 15 0" />
    <path d="M12 6.5v-1" />
    <path d="M2.5 20.5h19" />
  </svg>
);

/** A basket with a handle — the trolley round of a grocery. */
export const MartIcon = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 8h18l-1.6 9.2a2 2 0 0 1-2 1.8H6.6a2 2 0 0 1-2-1.8L3 8Z" />
    <path d="M8.5 8V6.2a3.5 3.5 0 0 1 7 0V8" />
    <path d="M9.5 12v3M14.5 12v3" />
  </svg>
);

/** A mortar and pestle rather than a cross — a chemist, not a hospital. */
export const PharmacyIcon = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M4 10h16a8 8 0 0 1-8 8 8 8 0 0 1-8-8Z" />
    <path d="M12 18v2.5M8.5 20.5h7" />
    <path d="M15.5 3.5 11 8.5" />
    <path d="M14 2.2l2.4 2.4" />
  </svg>
);

/** A hanging tag — the thing on the sleeve of everything a shop sells. */
export const RetailIcon = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M12.6 3.4 21 11.8a1.4 1.4 0 0 1 0 2l-7.2 7.2a1.4 1.4 0 0 1-2 0L3.4 12.6a1.4 1.4 0 0 1-.4-1V4.4A1.4 1.4 0 0 1 4.4 3h7.2c.37 0 .73.15 1 .4Z" />
    <circle cx="8" cy="8" r="1.4" />
  </svg>
);

/** Scissors — the trade that sells an hour, not a thing. */
export const ServicesIcon = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="6" cy="18" r="2.4" />
    <path d="M8.1 7.4 20 19" />
    <path d="M8.1 16.6 20 5" />
  </svg>
);

/** A wheel with a wrench through it — the bay, not a showroom. */
export const AutomotiveIcon = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="8.2" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.8v5M12 15.2v5M3.8 12h5M15.2 12h5" />
  </svg>
);

/** A ledger line finding its way up — money watched, not goods moved. */
export const FinanceIcon = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3.5 19.5h17" />
    <path d="M5 16.5 9.5 11l3.2 3 5.6-6.8" />
    <path d="M18.3 7.2h-3.1M18.3 7.2v3.1" />
  </svg>
);

/** A pump with its hose — a forecourt reads this instantly. */
export const PetroleumIcon = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M4 20.5V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15.5" />
    <path d="M3 20.5h11" />
    <path d="M6.5 7.5h4" />
    <path d="M13 9h3.2a2 2 0 0 1 2 2v5.2a1.6 1.6 0 0 0 3.2 0V11l-2.2-2.6" />
  </svg>
);
