/**
 * The storefront's own glyphs.
 *
 * Inline paths rather than an icon package, for the reason `Brand.tsx` gives
 * about the wordmark: an SVG loaded as a file is its own document and inherits
 * neither `currentColor` nor the theme, and every one of these sits on a
 * surface whose colour changes under it — a card that lifts, a header that
 * turns transparent over the hero, a button that inverts on hover.
 *
 * All of them are drawn on a 24 grid with a 1.7 stroke so they sit on the same
 * optical weight beside each other. A 20-grid icon dropped into this row reads
 * as bolder even at the same pixel size.
 */
const S = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type Props = { className?: string };

const Svg = ({ className = "size-5", children }: Props & { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    {children}
  </svg>
);

export const SearchIcon = ({ className }: Props) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="6.5" {...S} />
    <path d="m16 16 4 4" {...S} />
  </Svg>
);

export const CartIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.3a2 2 0 0 0 2-1.5L20 7H6" {...S} />
    <circle cx="10" cy="19.5" r="1.4" {...S} />
    <circle cx="17" cy="19.5" r="1.4" {...S} />
  </Svg>
);

export const HeartIcon = ({ className, filled = false }: Props & { filled?: boolean }) => (
  <Svg className={className}>
    <path
      d="M12 20s-7-4.4-7-9.3A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7 2.7C19 15.6 12 20 12 20Z"
      {...S}
      fill={filled ? "currentColor" : "none"}
    />
  </Svg>
);

export const StarIcon = ({ className, filled = true }: Props & { filled?: boolean }) => (
  <Svg className={className}>
    <path
      d="m12 4 2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.6-4.6 2.6.9-5.3L4.5 9.6l5.2-.7L12 4Z"
      {...S}
      fill={filled ? "currentColor" : "none"}
    />
  </Svg>
);

export const FilterIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M4 6h16M7 12h10M10 18h4" {...S} />
  </Svg>
);

export const CloseIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="m6 6 12 12M18 6 6 18" {...S} />
  </Svg>
);

export const PlusIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M12 5v14M5 12h14" {...S} />
  </Svg>
);

export const MinusIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M5 12h14" {...S} />
  </Svg>
);

export const TrashIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m-8 0 1 12a1.5 1.5 0 0 0 1.5 1.4h5A1.5 1.5 0 0 0 16 19l1-12" {...S} />
  </Svg>
);

export const StoreIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M4 9V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" {...S} />
    <path d="M3 9 4.8 4.6A1 1 0 0 1 5.7 4h12.6a1 1 0 0 1 .9.6L21 9a2.6 2.6 0 0 1-4.5 1.8A2.6 2.6 0 0 1 12 10a2.6 2.6 0 0 1-4.5.8A2.6 2.6 0 0 1 3 9Z" {...S} />
  </Svg>
);

export const TruckIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M3 7h10v9H3zM13 10h4l3 3v3h-7z" {...S} />
    <circle cx="7" cy="18" r="1.6" {...S} />
    <circle cx="17" cy="18" r="1.6" {...S} />
  </Svg>
);

export const ChevronRightIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="m9 6 6 6-6 6" {...S} />
  </Svg>
);

export const ChevronDownIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="m6 9 6 6 6-6" {...S} />
  </Svg>
);

export const CheckIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="m5 12.5 4.5 4.5L19 7" {...S} />
  </Svg>
);

export const PinIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" {...S} />
    <circle cx="12" cy="10" r="2.4" {...S} />
  </Svg>
);

export const BagIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M5 8h14l-1 12H6L5 8Z" {...S} />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" {...S} />
  </Svg>
);
