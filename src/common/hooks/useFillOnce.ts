import { useEffect, useRef } from "react";

/**
 * FILL A FORM FROM THE SERVER ONCE PER RECORD — NOT ON EVERY REFETCH.
 *
 * An edit form copied the record into its boxes whenever the query handed back
 * a new object, and a query hands back a new object on every refetch. On the
 * item form the till's catalogue sync refetches the product a few seconds after
 * the form opens: a grocer switched "Still selling this" off, pressed Save,
 * and the item was saved ON — the refetch had put the old value back under
 * their hand (2026-10-15 review, L10). Filled when the record first arrives,
 * and again only when a DIFFERENT record is opened.
 */
export function useFillOnce<T extends { id: string }>(record: T | undefined, fill: (record: T) => void): void {
  const filledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!record || filledFor.current === record.id) return;
    filledFor.current = record.id;
    fill(record);
    // `fill` is a fresh closure every render; the record's id is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);
}
