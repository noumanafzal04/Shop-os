import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiGet } from "../../../common/api/client";
import { useAuthStore } from "../../../stores/authStore";
import KeepShopModal from "./KeepShopModal";

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
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!tenant?.is_demo) return;
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);

    return () => window.clearInterval(t);
  }, [tenant?.is_demo]);

  // Is somebody already waiting on an answer? The banner has to stop asking
  // for something it has already been given — a shop that keeps offering
  // "Keep this shop" after the request went in reads as though nobody heard.
  const pending = useQuery({
    queryKey: ["shop", "keep"],
    queryFn: () => apiGet<{ id: string } | null>("/shop/keep"),
    enabled: Boolean(tenant?.is_demo),
    staleTime: 60_000,
  });

  if (!tenant?.is_demo) return null;

  const asked = Boolean(pending.data?.data);
  const ends = tenant.demo_expires_at ? new Date(tenant.demo_expires_at) : null;
  const gone = ends !== null && ends.getTime() <= Date.now();
  const when = ends?.toLocaleString(undefined, {
    weekday: "short", hour: "numeric", minute: "2-digit",
  });

  return (
    <>
    <div
      data-demo-banner
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-brand-500 px-4 py-2 text-center text-theme-xs font-medium text-white"
    >
      <span>
        {asked
          // Once they have asked, nothing is going to delete this shop —
          // the prune leaves a tenant with a request outstanding alone — so
          // the countdown stops being the truth and stops being shown.
          ? <>We have your request. Your shop is <strong className="font-semibold">safe</strong> while we look at it.</>
          : gone
            ? "This demo shop has ended — nothing here is saved."
            : <>Demo shop — yours alone. It clears itself away{when ? <> at <strong className="font-semibold">{when}</strong></> : " after a day"}.</>}
      </span>

      {!asked && (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="rounded-md bg-white/15 px-2.5 py-1 font-semibold transition hover:bg-white/25"
        >
          {/* The only place an email is ever asked for, and only from somebody
              who has already decided they want to keep what they built. Asking
              on the way IN loses the shopkeeper who would have bought it. */}
          Keep this shop
        </button>
      )}


    </div>

    {/* A SIBLING, not a child. `Modal` renders where it is declared rather
        than through a portal, so anything it sits inside styles it — and this
        banner is `text-center`, which quietly centred every label in the form.
        A dialog is not part of the strip that opened it. */}
    <KeepShopModal open={asking} onClose={() => setAsking(false)} />
    </>
  );
}
