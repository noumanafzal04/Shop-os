/**
 * Turn Phosphor's SVG files into one TypeScript module.
 *
 * ── Why a generator and not eighty pasted path strings ───────────────
 *
 * The alternative to a dependency is a file full of numbers nobody can check.
 * This script is what makes them checkable: every path in the generated module
 * came out of a named file at a pinned version, and running it again either
 * reproduces the file byte for byte or shows exactly what upstream changed.
 *
 * ── Why not the npm package ──────────────────────────────────────────
 *
 * `@phosphor-icons/react-native` is 76MB installed and its barrel eagerly
 * `require`s 1,512 icon modules at startup; the only per-icon subpath it
 * offers is raw .tsx that does not compile against this project. The DRAWINGS
 * are what this app wants — twenty of them — not a library.
 *
 *     node scripts/build-icons.mjs
 *
 * Needs network. The output is committed, so a normal build never runs it.
 */
import { writeFileSync } from "node:fs";

const VERSION = "2.1.1";
const BASE = `https://cdn.jsdelivr.net/npm/@phosphor-icons/core@${VERSION}/assets`;

/**
 * The set, as `Name: phosphor-file`.
 *
 * Chosen for the ROW each one sits on, not for the closest translation of the
 * old icon's name: `Bike` became `Motorcycle` because a rider in Lahore is on
 * a motorbike, and a bicycle glyph on the "Deliveries" tab was a small
 * untruth repeated on every screen.
 */
const ICONS = {
  // The tab bar
  Home: "house",
  Basket: "basket",
  Cart: "shopping-cart-simple",
  Receipt: "receipt",
  Person: "user",
  Parcel: "package",
  Wallet: "wallet",

  // The side menu and the account page
  Bell: "bell",
  Motorcycle: "motorcycle",
  Calendar: "calendar-dots",
  ChevronRight: "caret-right",
  FileText: "file-text",
  Heart: "heart",
  LifeBuoy: "lifebuoy",
  SignOut: "sign-out",
  MapPin: "map-pin",
  Pencil: "pencil-simple",
  Refresh: "arrows-clockwise",
  Gear: "gear-six",
  Bag: "shopping-bag-open",
  Info: "info",
  Palette: "palette",
  ShieldCheck: "shield-check",
  Star: "star",
  Banknote: "money",
  Storefront: "storefront",

  // The trades, and the home screen's shortcut tiles
  Utensils: "fork-knife",
  Pill: "pill",
  Wrench: "wrench",
  Car: "car",
  Fuel: "gas-pump",
  Bank: "bank",
  Scissors: "scissors",
  Drill: "hammer",
  Box: "package",
  Book: "book-open",
  Croissant: "bread",
  Question: "question",
  Tag: "tag",
  Sparkle: "sparkle",
  // "Under Rs 500" was a pair of FOOTPRINTS, which is a glyph about walking.
  Coins: "coins",

  // Forms, and the things a person is asked for
  //
  // `Envelope`, not an at-sign. "@" is a character out of an address, not a
  // picture of one — and beside a padlock and a telephone, which are both
  // objects, it reads as a typo the field has picked up. Asked for directly:
  // "email k liye envelope icon jo hota wo use kro, @ ye ni".
  Envelope: "envelope-simple",
  Lock: "lock-simple",
  Phone: "phone",
  BadgeCheck: "seal-check",
  Clock: "clock",
  Search: "magnifying-glass",
  ArrowLeft: "arrow-left",
  ArrowRight: "arrow-right",
  Check: "check",
  Warning: "warning-circle",

  // ── The rest of the app ────────────────────────────────────────────
  //
  // Sixty distinct lucide glyphs were still in use after the bar, the menus
  // and the tiles moved, which meant the home screen had Phosphor trade tiles
  // under a lucide header — two families on the most-looked-at screen in the
  // app. Two coherent sets mixed is worse than either alone, and "baki b jahan
  // need hai" is the whole of the brief.
  Plus: "plus",
  Minus: "minus",
  X: "x",
  ChevronDown: "caret-down",
  ChevronUp: "caret-up",
  Menu: "list",
  Sliders: "sliders-horizontal",
  Trash: "trash",
  Eye: "eye",
  EyeOff: "eye-slash",
  Rotate: "arrow-clockwise",
  CloudOff: "cloud-slash",
  Monitor: "monitor",
  Phone2: "device-mobile",
  Tablet: "device-tablet",
  Moon: "moon",
  Sun: "sun",
  Key: "key",
  Navigation: "navigation-arrow",
  Crosshair: "crosshair-simple",
  Building: "buildings",
  Truck: "truck",
  Upload: "upload-simple",
  IdCard: "identification-card",
  Ticket: "ticket",
  Confetti: "confetti",
  Quote: "quotes",
  CheckCircle: "check-circle",
  XCircle: "x-circle",
  AlertTriangle: "warning",
  PackageSearch: "magnifying-glass-plus",
  ArrowUpLeft: "arrow-up-left",
  // The "there are more of these" tile at the end of the home grid. A grid,
  // not a hamburger and not a plus: one means a menu and the other means add.
  Grid: "squares-four",
};

/**
 * THE TWO WEIGHTS, AND WHY THEY ARE THESE TWO.
 *
 * Phosphor ships six — thin, light, regular, bold, fill, duotone — and this
 * app has now been through three pairs of them:
 *
 *   regular / fill     the obvious answer, and wrong on a phone. At 22 points
 *                      a solid house is a pentagon and a solid basket is a
 *                      bucket: the interior is exactly the part that made each
 *                      icon recognisable, and the fill is what removes it.
 *   regular / bold     right in shape, too heavy in weight — "active icon
 *                      thora sa zyada thick hai".
 *   light / regular    here. The selected state is now exactly the weight the
 *                      UNSELECTED one used to be, so it reads as emphasis
 *                      rather than as a different object, and the whole bar
 *                      got slimmer with it.
 *
 * The colour is doing most of the work — muted grey to brand orange — and the
 * weight is the second half of the signal, not the whole of it.
 */
const WEIGHTS = { off: "light", on: "regular" };

const svg = async (weight, name) => {
  const file = weight === "regular" ? `${name}.svg` : `${name}-${weight}.svg`;
  const res = await fetch(`${BASE}/${weight}/${file}`);
  if (!res.ok) throw new Error(`${weight}/${file} → ${res.status}`);
  const body = await res.text();

  const box = body.match(/viewBox="([^"]+)"/)?.[1];
  if (box !== "0 0 256 256") throw new Error(`${file}: unexpected viewBox ${box}`);

  // One path per icon is what makes the component a one-liner. An icon that
  // arrives as two is a real change upstream and should stop the build rather
  // than be silently half-drawn.
  const paths = [...body.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length !== 1) throw new Error(`${file}: ${paths.length} paths, expected 1`);
  if (/stroke=/.test(body)) throw new Error(`${file}: has a stroke; this set is fills only`);

  return paths[0];
};

const names = Object.keys(ICONS);

/**
 * A generated file has to be able to refuse itself.
 *
 * The path constants are the icon's name in capitals, so an icon called `Box`
 * emits `const BOX`, which is what the viewBox constant was called — a file
 * that compiles to two declarations of one name. Caught by tsc, but the fix
 * belongs here: the generator knows the names, and the next collision is
 * somebody's afternoon otherwise.
 */
const RESERVED = new Set(["VIEW_BOX", "ICONS", "GLYPH"]);
const clash = names.map((n) => n.toUpperCase()).filter((n) => RESERVED.has(n));
if (clash.length) throw new Error(`icon name collides with a constant: ${clash.join(", ")}`);
if (new Set(names.map((n) => n.toUpperCase())).size !== names.length) {
  throw new Error("two icons differ only by case");
}
const drawn = {};
for (const name of names) {
  drawn[name] = {
    off: await svg(WEIGHTS.off, ICONS[name]),
    on: await svg(WEIGHTS.on, ICONS[name]),
  };
  if (drawn[name].off === drawn[name].on) throw new Error(`${name}: both weights identical`);
  process.stdout.write(`${name} `);
}
console.log(`\n${names.length} icons`);

const head = `import React from "react";
import Svg, { Path } from "react-native-svg";

/**
 * THE APP'S ICONS.
 *
 * ── GENERATED. Edit \`scripts/build-icons.mjs\`, not this file ──────────
 *
 * Phosphor's own path data, MIT licensed, copied from \`@phosphor-icons/core\`
 * v${VERSION}. See LICENSE-icons.md.
 *
 * ── Why the drawings are imported and the code is not ────────────────
 *
 * Every way of installing an icon set fails on something this app cannot pay:
 *
 *   lucide-react-native  — outline only, no heavier weight, so a selected tab
 *                          could differ from an unselected one by half a point
 *                          of stroke and nothing else.
 *   a vector-icon FONT   — a native rebuild, on a project whose APK has to
 *                          keep building without a Firebase config.
 *   @phosphor-icons/react-native — 76MB installed, and its barrel eagerly
 *                          \`require\`s 1,512 icon modules at startup.
 *
 * Twenty drawings is a few kilobytes of path data. A library is a dependency.
 *
 * ── Two weights, and neither of them is a solid ──────────────────────
 *
 * Regular and BOLD — the same silhouette at two line weights, which is how a
 * selected tab announces itself without becoming a blob. The first version of
 * this used Phosphor's \`fill\` weight for the selected state and it was wrong
 * for the reason solid glyphs usually are: at 22 points a filled house is a
 * pentagon, a filled basket is a bucket, and the thing that made each icon
 * recognisable — its interior — is the part the fill removes.
 *
 * Both weights are FILLED PATHS with the middle cut out, not strokes, so there
 * is no stroke width to keep in step and no chance of the two states reading
 * at different sizes.
 */

export interface IconProps {
  size?: number;
  color: string;
  /** The heavier weight — for the tab you are on, or a row that is selected. */
  bold?: boolean;
}

/**
 * An icon, as a VALUE — for the menus that hold their rows as data.
 *
 * A component type, not the props type. LucideIcon filled this slot before
 * and the two are easy to confuse, because assigning a component where props
 * are expected is a type error rather than a runtime one — which is the good
 * outcome, and the reason this alias exists rather than each caller writing
 * its own.
 */
export type Icon = (props: IconProps) => React.JSX.Element;

/** Phosphor draws on a 256 grid. Kept, so every path can be diffed upstream. */
const VIEW_BOX = "0 0 256 256";

function Glyph({ size = 22, color, bold = false, d }: IconProps & { d: { off: string; on: string } }) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX}>
      <Path d={bold ? d.on : d.off} fill={color} />
    </Svg>
  );
}

/** Every icon in the app, so a caller can pick one by name. */
export type IconName = ${names.map((n) => `"${n}"`).join(" | ")};

`;

const body = names
  .map(
    (n) => `/** Phosphor \`${ICONS[n]}\`. */
const ${n.toUpperCase()} = {
  off: "${drawn[n].off}",
  on: "${drawn[n].on}",
};

export function ${n}Icon(props: IconProps) {
  return <Glyph {...props} d={${n.toUpperCase()}} />;
}
`,
  )
  .join("\n");

const tail = `
/** Name → component, for menus that hold their icons as data. */
export const ICONS: Record<IconName, Icon> = {
${names.map((n) => `  ${n}: ${n}Icon,`).join("\n")}
};
`;

writeFileSync(new URL("../src/common/ui/icons/index.tsx", import.meta.url), head + body + tail);
console.log("wrote src/common/ui/icons/index.tsx");
