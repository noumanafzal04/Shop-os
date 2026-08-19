import { useEffect, type RefObject } from "react";

/**
 * A banner pinned to the bottom of the screen must not sit ON the page.
 *
 * The install prompt is `fixed bottom-3` at `z-[999998]` — above everything —
 * so it lands ON the page rather than beside it. A browser found it sitting on
 * top of a control on eleven screens at once; on the dashboard that was the
 * "Shop street address" field, and a shop reaching for it hits a banner.
 *
 * To be exact about the harm, because the first version of this comment was
 * not: those controls were still REACHABLE. The page had scroll room, so a
 * scroll brought them out from under the card. What is wrong is that the shop
 * has to discover that — it taps a field and gets a banner, with nothing saying
 * the field is a flick away.
 *
 * Nothing in the source is wrong on either side. It is only wrong once both are
 * on a screen at the same size, which is why a thousand jsdom tests could not
 * see it.
 *
 * So the page reserves the room instead. The banner measures itself into
 * `--pinned-bottom`, the layout pads by exactly that, and the page ends above
 * the card rather than behind it. Measuring rather than hard-coding matters:
 * the prompt is two lines on Chrome and four on Safari, whose copy has to
 * explain Share → Add to Home Screen.
 */
export function useReservesBottomRoom(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (el === null) {
      root.style.removeProperty("--pinned-bottom");
      return;
    }

    const measure = () => {
      // Its own height plus the gap it floats above the edge.
      const room = Math.ceil(el.getBoundingClientRect().height) + 24;
      root.style.setProperty("--pinned-bottom", `${room}px`);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      // Gone means gone: a page that keeps padding for a banner nobody can see
      // has a strip of dead space at the bottom for the rest of the session.
      root.style.removeProperty("--pinned-bottom");
    };
  }, [ref]);
}
