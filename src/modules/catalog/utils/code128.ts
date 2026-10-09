/**
 * Self-contained Code 128 barcode encoder → SVG string. No dependency, works
 * offline / under strict CSP. Covers ASCII 32–126: a run of digits goes out in
 * Set C (two digits a symbol), anything else in Set B.
 *
 * Each table entry is the module bit-pattern (1 = bar, 0 = space); data
 * symbols are 11 modules, the stop symbol is 13.
 */
const PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "1100011101011",
];

const START_B = 104;
const START_C = 105;
/** In Set C: "what follows is Set B". */
const CODE_B = 100;
const STOP = 106;

/**
 * Blank modules either side of the code. Not decoration — a scanner needs this
 * margin to find the start of the symbol, so it travels with the bars and gets
 * scaled with them.
 */
const QUIET = 10;

/**
 * The symbols a value is made of, before the check symbol and the stop.
 *
 * ── Why digits go in pairs ──────────────────────────────────────────────
 *
 * Every barcode a manufacturer prints is a number, thirteen digits long. In
 * Set B that is thirteen symbols — 198 modules with its quiet zones — and on
 * the standard 50 mm sticker each bar came out 0.24 mm wide: under what a
 * supermarket scanner reliably reads, so the page warned "too long for this
 * sticker" about EVERY ordinary product, on the default size.
 *
 * Set C carries two digits in one symbol. The same number is 143 modules and
 * its bars 0.33 mm — the same sticker, and it scans. An odd digit left over at
 * the end is said in Set B, after the symbol that announces the change.
 *
 * Only a value that is ALL digits is treated this way. Switching sets inside a
 * mixed code ("MILK-1L-004") saves little and is one more thing to get wrong.
 */
function symbolsOf(value: string): number[] {
  if (/^\d{4,}$/.test(value)) {
    const symbols = [START_C];
    const paired = value.length - (value.length % 2);

    for (let i = 0; i < paired; i += 2) symbols.push(Number(value.slice(i, i + 2)));
    if (paired < value.length) symbols.push(CODE_B, value.charCodeAt(paired) - 32);

    return symbols;
  }

  return [
    START_B,
    ...value.split("").map((ch) => {
      const code = ch.charCodeAt(0);

      return code >= 32 && code <= 126 ? code - 32 : 0; // fall back to space
    }),
  ];
}

/** Build the full module bit-string for a value. */
function encode(value: string): string {
  const symbols = symbolsOf(value);

  // The start symbol counts once; every symbol after it by its position.
  const checksum = symbols.reduce((sum, symbol, i) => sum + symbol * Math.max(1, i), 0) % 103;

  return [...symbols, checksum, STOP].map((s) => PATTERNS[s]).join("");
}

/**
 * The one place a barcode's own characters reach the markup.
 *
 * Everywhere else in this file the input is gone by the time anything is
 * built: `encode` turns it into a run of 1s and 0s and only computed integers
 * become `<rect>`. The human-readable line under the bars is the exception —
 * it prints the string itself.
 *
 * Code 128-B covers every printable ASCII character, `<` and `>` and `"`
 * included, so a barcode reading `</text><script>...` survives encoding intact.
 * These SVG strings are rendered through `dangerouslySetInnerHTML`, which is
 * the whole reason this matters: a barcode typed into a product form, or landed
 * by a supplier's CSV import, would otherwise be script running inside the
 * shop's own session on every label sheet somebody printed.
 *
 * Not reachable today — `code128Svg` has no caller — and that is exactly the
 * argument for escaping it now rather than the day it gets one.
 */
function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[c] ?? c);
}

export interface BarcodeOptions {
  height?: number;      // bar height in px
  moduleWidth?: number; // px per module
  showText?: boolean;
}

/**
 * How many modules wide the finished symbol is, quiet zones included.
 *
 * A label prints at a fixed physical width, so this is what decides how thin
 * each bar ends up. Divide the printable width by this and you have the
 * X-dimension — the one number that says whether a scanner will read it.
 */
export function code128ModuleCount(value: string): number {
  return encode(value).length + QUIET * 2;
}

/**
 * Bars alone, as an SVG that fills whatever box it is given.
 *
 * Labels are cut to a physical size, so the barcode has to be sized by the
 * label rather than the label by the barcode — the fixed-width variant below
 * happily renders 280px of bars into a 50mm sticker and spills over its
 * neighbours. Every bar is scaled by the same factor, so the symbol stays
 * readable; the human-readable digits are drawn separately in HTML, where they
 * keep their own proportions instead of stretching with the bars.
 */
export function code128BarsSvg(value: string): string {
  const bits = encode(value);
  const total = bits.length + QUIET * 2;

  let rects = "";
  let x = QUIET;
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === "1") {
      let run = 1;
      while (i + run < bits.length && bits[i + run] === "1") run++;
      rects += `<rect x="${x}" y="0" width="${run}" height="100" fill="#000"/>`;
      x += run;
      i += run;
    } else {
      x += 1;
      i += 1;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${total} 100" preserveAspectRatio="none" shape-rendering="crispEdges">${rects}</svg>`;
}

/** Render a scannable Code128 barcode as an inline SVG string. */
export function code128Svg(value: string, opts: BarcodeOptions = {}): string {
  const { height = 44, moduleWidth = 1.6, showText = true } = opts;
  const bits = encode(value);
  const quiet = QUIET; // quiet zone in modules
  const totalModules = bits.length + quiet * 2;
  const width = totalModules * moduleWidth;
  const textH = showText ? 14 : 0;

  let rects = "";
  let x = quiet;
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === "1") {
      let run = 1;
      while (i + run < bits.length && bits[i + run] === "1") run++;
      rects += `<rect x="${(x * moduleWidth).toFixed(2)}" y="0" width="${(run * moduleWidth).toFixed(2)}" height="${height}" fill="#000"/>`;
      x += run;
      i += run;
    } else {
      x += 1;
      i += 1;
    }
  }

  const text = showText
    ? `<text x="${(width / 2).toFixed(2)}" y="${height + 11}" text-anchor="middle" font-family="monospace" font-size="11" fill="#000">${escapeXml(value)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height + textH}" viewBox="0 0 ${width.toFixed(2)} ${height + textH}"><rect width="100%" height="100%" fill="#fff"/>${rects}${text}</svg>`;
}
