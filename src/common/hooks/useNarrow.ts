import { useEffect, useState } from "react";

/**
 * IS THIS SCREEN NARROWER THAN `px`?
 *
 * For a list that is a TABLE on a counter and CARDS in a hand. One or the
 * other is drawn — never both hidden by CSS — because a list that failed to
 * load says so in each copy, and two alerts for one failure is a page that
 * contradicts itself (and a test that cannot tell which one it is reading).
 *
 * False where the browser cannot say (no matchMedia), so a test environment
 * gets the wide screen it was written against.
 */
export function useNarrow(px = 768): boolean {
  const query = `(max-width: ${px - 1}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);

  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.(query) : undefined;
    if (!mq) return;
    const changed = () => setNarrow(mq.matches);
    changed();
    mq.addEventListener("change", changed);

    return () => mq.removeEventListener("change", changed);
  }, [query]);

  return narrow;
}
