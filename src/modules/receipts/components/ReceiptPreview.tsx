import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReceiptPreview } from "../hooks/useReceipts";

/** Natural page width of each receipt size, in CSS px, as the template renders it. */
const PAPER_PX: Record<string, number> = {
  thermal_58: 220,
  thermal_80: 300,
  standard: 800,
};

/** Held for a beat so the preview follows the typing instead of racing it. */
function useSettled<T>(value: T, ms = 450): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

interface Props {
  /** The settings being edited — not the saved ones. That is the point. */
  settings: Record<string, string | number | boolean | string[] | null>;
  /** Show the copy as a reprint, so the stamp can be judged too. */
  kind?: "original" | "reprint" | "gift";
}

/**
 * The receipt, as it will print, next to the settings that decide it.
 *
 * Rendered by the SERVER from the same Blade template the counter prints, so
 * this is the document itself and not a drawing of one — a preview that could
 * drift from the real receipt would be worse than none.
 */
export function ReceiptPreview({ settings, kind }: Props) {
  const settled = useSettled(kind ? { ...settings, kind } : settings);
  const { data, isFetching, isError } = useReceiptPreview(settled);

  const width = String(settled.receipt_width ?? "standard");
  const paper = PAPER_PX[width] ?? PAPER_PX.standard;

  // Scale the page down to whatever column it was given, never up: a 58mm roll
  // blown up to 800px would read as a design it isn't.
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / paper));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paper]);

  const PAGE_H = width === "standard" ? 1000 : 760;

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">Receipt preview</h4>
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            Sample sale · {width === "standard" ? "A4 / Letter" : width === "thermal_80" ? "80mm roll" : "58mm roll"}
          </p>
        </div>
        {isFetching && <span className="text-theme-xs text-gray-400">Updating…</span>}
      </div>

      {isError ? (
        <p className="py-10 text-center text-theme-sm text-gray-500 dark:text-gray-400">
          Couldn't load the preview.
        </p>
      ) : (
        <div ref={boxRef} className="flex justify-center overflow-hidden">
          <div style={{ width: paper * scale, height: PAGE_H * scale }}>
            <iframe
              // srcDoc, not a URL: the preview is authenticated HTML we already
              // hold, and a src would fetch it again without the token.
              srcDoc={data ?? "<!doctype html><body style='margin:0'></body>"}
              title="Receipt preview"
              sandbox=""
              className="border-0 bg-white shadow-theme-xs"
              style={{
                width: paper,
                height: PAGE_H,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
