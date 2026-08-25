import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useAuthStore } from "../../../stores/authStore";

/**
 * "THIS SHOP ENDS AT …" — said on every screen of a demo, and said honestly.
 *
 * The landing page promises the shop "clears itself away after a day". A
 * promise made on the way in and never repeated is a promise somebody has
 * forgotten by the time it comes true — they will have typed real products
 * into it. So the whole time they are inside, the shop says what it is and
 * when it ends.
 *
 * A REAL TIME, not "expires soon". The expiry is absolute from creation
 * precisely so this line can be a sentence a person can plan around; a sliding
 * window could not be printed truthfully at all.
 */
export default function DemoBanner() {
  const tenant = useAuthStore((s) => s.user?.tenant);
  // Re-rendered on a slow tick so "in 3 hours" does not sit there saying
  // yesterday's answer for the length of a session.
  const [, tick] = useState(0);

  useEffect(() => {
    if (!tenant?.is_demo) return;
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);

    return () => window.clearInterval(t);
  }, [tenant?.is_demo]);

  if (!tenant?.is_demo) return null;

  const ends = tenant.demo_expires_at ? new Date(tenant.demo_expires_at) : null;
  const gone = ends !== null && ends.getTime() <= Date.now();
  const when = ends?.toLocaleString(undefined, {
    weekday: "short", hour: "numeric", minute: "2-digit",
  });

  return (
    <div
      data-demo-banner
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-brand-500 px-4 py-2 text-center text-theme-xs font-medium text-white"
    >
      <span>
        {gone
          ? "This demo shop has ended — nothing here is saved."
          : <>Demo shop — yours alone. It clears itself away{when ? <> at <strong className="font-semibold">{when}</strong></> : " after a day"}.</>}
      </span>
      <Link
        to="/signup"
        className="rounded-md bg-white/15 px-2.5 py-1 font-semibold underline-offset-2 transition hover:bg-white/25"
      >
        {/* The only place an email is asked for, and only from somebody who has
            already decided they want to keep what they built. Asking on the way
            IN loses the shopkeeper who would have bought it. */}
        Keep this shop
      </Link>
    </div>
  );
}
