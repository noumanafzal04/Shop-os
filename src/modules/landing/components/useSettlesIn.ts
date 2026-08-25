import { useEffect } from "react";

/**
 * Adds `is-in` to every `.settles` on the page as it reaches the viewport.
 *
 * An observer rather than a scroll listener: a scroll handler runs on every
 * frame of every scroll for the life of the page, to answer a question that
 * changes about a dozen times. And each element is unobserved the moment it
 * has arrived, so nothing animates twice and the observer empties itself.
 *
 * If the browser has no IntersectionObserver — or the page is rendered
 * somewhere without one — everything is marked arrived immediately. A landing
 * page that shows nothing is worse than one that shows everything at once.
 */
export function useSettlesIn(): void {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>(".settles"));
    if (targets.length === 0) return;

    // No observer, no hiding. The page stays exactly as the server sent it.
    if (typeof IntersectionObserver === "undefined") return;

    // Only NOW is anything allowed to be invisible — see `.settling` in
    // index.css. Until this line runs the whole page is on screen, which is the
    // state it must fail into.
    const root = document.documentElement;
    root.classList.add("settling");

    const seen = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      // A little before the edge, so a section is settled by the time it is
      // properly on screen rather than starting as it appears.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );

    targets.forEach((el) => seen.observe(el));

    return () => {
      seen.disconnect();
      root.classList.remove("settling");
    };
  }, []);
}
