import { daysWaiting, howLong } from "./waitingTime";

/**
 * "waiting 3 days" — and it is deliberately blunt once it is more than a
 * couple, because nothing else in either queue applies any pressure. Neither
 * a shop request nor an enquiry expires, is escalated or is taken away; the
 * only thing that says a queue is being run badly is this line going red.
 */
export function Waiting({ since }: { since: string }) {
  const days = daysWaiting(since);
  if (days < 1) return <span className="text-gray-500 dark:text-gray-400">today</span>;

  return (
    <span className={days >= 3 ? "font-semibold text-error-600 dark:text-error-400" : "text-gray-500 dark:text-gray-400"}>
      waiting {howLong(since)}
    </span>
  );
}
