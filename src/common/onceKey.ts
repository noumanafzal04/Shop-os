import { useCallback, useState } from "react";

import { uuid } from "./uuid";

/**
 * ONE KEY FOR ONE THING BEING RECORDED.
 *
 * A form that moves money sends this with what it saves; the server keeps the
 * first answer against it (AnswerOnce) and gives a second press — a
 * double-click, a retry after the line dropped — that same answer instead of a
 * second record. Tester pass 1 (B07): a khata payment, a supplier payment and
 * an expense were each recorded twice by one double-click.
 *
 * The key stays the same until `renew()` — call it when the thing was SAVED,
 * so the next one is a new record. A refusal keeps it: the server let it go,
 * and the corrected form is still the same payment.
 */
export function useOnceKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(uuid);
  const renew = useCallback(() => setKey(uuid()), []);

  return { key, renew };
}
