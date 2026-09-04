/**
 * A CALIBRATION CHART ARRIVES AS PASTED TEXT.
 *
 * Not as a form. A station's chart is a printed table — often a manufacturer's
 * certificate they have had for twenty years, sometimes a spreadsheet — with
 * anywhere from twenty rows to two thousand. Asking somebody to key two
 * thousand pairs into a form is asking them not to load the chart at all, and
 * a tank with no chart means the closing dip is a hand lookup by torchlight
 * into the one number the whole leak detection rests on.
 *
 * So this parses what a person actually has: two columns, in whatever the
 * source used to separate them — a tab out of Excel, a comma out of a CSV,
 * spaces out of a PDF.
 *
 * It is deliberately strict about the SHAPE and silent about the CURVE. Where
 * a tank steepens and where it flattens is a fact about that tank measured by
 * whoever certified it; nothing here is entitled to an opinion on it. The one
 * check that belongs to a parser is "is this two numbers", and the one check
 * that belongs to the server is "does a deeper reading hold more".
 */

export interface DipPoint {
  mm: number;
  litres: number;
}

export interface ParsedChart {
  points: DipPoint[];
  /** Lines that were not two numbers, with their 1-based line number. */
  rejected: Array<{ line: number; text: string }>;
}

/**
 * Split on tab, comma, semicolon or runs of spaces. A chart written
 * "620, 1180.5" and one written "620\t1180.5" are the same chart, and a station
 * should not have to know which one we wanted.
 */
const CELLS = /[\t;,]+|\s{1,}/;

/**
 * THE COMMA IS BOTH A SEPARATOR AND A THOUSANDS MARK, and splitting first gets
 * it wrong. "620\t12,500" split on commas is three cells — 620, 12, 500 — and
 * the tank is recorded as holding TWELVE litres at 620mm. Caught by a test,
 * which is the only reason it is not in the ground.
 *
 * So a comma sitting between a digit and exactly three digits is a thousands
 * mark and is removed BEFORE the line is split. Anywhere else it separates.
 */
function unThousand(line: string): string {
  let out = line;
  let previous: string;

  do {
    previous = out;
    out = out.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  } while (out !== previous);

  return out;
}

function toNumber(cell: string): number | null {
  const cleaned = cell.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDipChart(text: string): ParsedChart {
  const points: DipPoint[] = [];
  const rejected: ParsedChart["rejected"] = [];
  const seen = new Set<number>();

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;

    const cells = unThousand(line).split(CELLS).filter((c) => c !== "");
    const mm = cells.length >= 2 ? toNumber(cells[0]) : null;
    const litres = cells.length >= 2 ? toNumber(cells[1]) : null;

    if (mm === null || litres === null) {
      // A HEADER IS ONLY A HEADER AT THE TOP.
      //
      // "mm, litres" on line one is normal in a pasted table and reporting it
      // would teach the reader to ignore the rejected list — which is exactly
      // where the real mistakes go. But the first version tested only for
      // "letters and punctuation", so "about half full" written in the middle
      // of a chart was silently swallowed too. A line with no digits is a
      // header on line one and a mistake anywhere else.
      const isHeader = index === 0 && !/\d/.test(line);
      if (!isHeader) rejected.push({ line: index + 1, text: line });
      return;
    }

    if (mm < 0 || litres < 0) {
      rejected.push({ line: index + 1, text: line });
      return;
    }

    // A depth listed twice is a paste that went wrong, and the second row would
    // silently win. Named rather than merged.
    const depth = Math.round(mm);
    if (seen.has(depth)) {
      rejected.push({ line: index + 1, text: line });
      return;
    }

    seen.add(depth);
    points.push({ mm: depth, litres: Math.round(litres * 1000) / 1000 });
  });

  points.sort((a, b) => a.mm - b.mm);

  return { points, rejected };
}

/** The chart as text again, so a loaded chart can be corrected rather than re-pasted. */
export function dipChartToText(points: DipPoint[]): string {
  return points.map((p) => `${p.mm}\t${p.litres}`).join("\n");
}
