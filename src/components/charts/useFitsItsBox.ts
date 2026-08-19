import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * THE WIDTH THE CHART SHOULD BE, MEASURED FROM THE BOX IT IS IN.
 *
 * ApexCharts writes an INLINE PIXEL WIDTH onto `.apexcharts-canvas` from
 * whatever its parent measured at mount, and it re-measures on `window.resize`
 * and nothing else. A container that changes width without the window changing
 * — and this app has several: the sidebar rail collapses below `xl`, a drawer
 * opens, a filter row wraps — leaves the canvas at its old pixel width. When
 * that old width is the larger one, a fixed-width canvas sits inside a narrower
 * page and **the whole page scrolls sideways**, which on a till is how a Close
 * button ends up somewhere nobody can reach.
 *
 * Caught by the browser suite on a tablet held landscape: 1115px of canvas in a
 * 1080px window.
 *
 * So the box is watched, not the window, and the number is handed to the chart.
 */
export function useFitsItsBox(box: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  // Measured widths arrive fractional; re-rendering on 0.5px of drift would
  // remount the chart while somebody is reading it.
  const last = useRef(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;

    const measure = (): void => {
      const w = Math.floor(el.clientWidth);
      if (w > 0 && Math.abs(w - last.current) >= 1) {
        last.current = w;
        setWidth(w);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);

    return () => observer.disconnect();
  }, [box]);

  return width;
}
