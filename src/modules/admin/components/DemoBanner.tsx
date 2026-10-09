import { useState } from "react";

import { failed } from "../../../common/api/failed";
import Button from "../../../components/ui/button/Button";
import { useToast } from "../../../components/ui/toast";
import { ShootingStarIcon } from "../../../icons";
import { useApproveShopRequest } from "../hooks/useDemoShops";
import { ends } from "./demoClock";
import { KeepDemoDialog } from "./KeepDemoDialog";
import { howLong } from "./waitingTime";

/**
 * A DEMO, ON ITS OWN PAGE — said, and with the one thing to do about it.
 *
 * A demo's page looked exactly like a real shop's: the same details, the same
 * plan card, the same actions. Nothing said the shop would be gone tomorrow,
 * that nobody on earth could sign in to it, or that it could be kept.
 *
 * So the page says all three, above everything else, and offers the one
 * decision there is to make:
 *
 *   nobody has asked   → "Make it a real shop" — the admin types the sign-in
 *                        its owner will use (KeepDemoDialog)
 *   its owner asked    → "Approve" — they already chose their own sign-in when
 *                        they asked, and writing a new password over it would
 *                        lock them out of the one they are expecting to use
 */
export function DemoBanner({
  tenant,
}: {
  tenant: {
    id: string;
    business_name: string;
    demo_expires_at?: string | null;
    keep_request?: { id: string; contact_name: string; contact_email: string; requested_at: string | null } | null;
  };
}) {
  const toast = useToast();
  const [keeping, setKeeping] = useState(false);
  const clock = ends(tenant.demo_expires_at ?? null);
  const asked = tenant.keep_request ?? null;
  const approve = useApproveShopRequest();

  return (
    <>
      <div
        data-testid="demo-banner"
        className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-theme-purple-500/20 bg-theme-purple-500/[0.07] p-4 dark:border-theme-purple-500/30 dark:bg-theme-purple-500/10 sm:p-5"
      >
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-theme-purple-500 text-white [&>svg]:size-5">
          <ShootingStarIcon />
        </span>

        <div className="min-w-0 flex-1 basis-64">
          <p className="font-semibold text-gray-800 dark:text-white/90">
            This is a demo shop · {clock.text.toLowerCase()}
          </p>
          <p className="mt-0.5 text-theme-sm text-gray-600 dark:text-gray-300">
            {asked ? (
              <>
                <strong className="font-semibold">{asked.contact_name}</strong> ({asked.contact_email}) asked to keep it
                {asked.requested_at ? ` ${howLong(asked.requested_at)} ago` : ""} and already has a sign-in of their own.
              </>
            ) : (
              <>
                Somebody opened it from the front page to try. Nobody can sign in to it, and it clears itself away
                unless it is kept.
              </>
            )}
          </p>
        </div>

        {asked ? (
          <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(asked.id, failed(toast, "That did not go through."))}>
            {approve.isPending ? "Approving…" : "Approve their request"}
          </Button>
        ) : (
          <Button size="sm" onClick={() => setKeeping(true)}>Make it a real shop</Button>
        )}
      </div>

      {keeping && (
        <KeepDemoDialog
          demo={{ id: tenant.id, business_name: tenant.business_name }}
          onClose={() => setKeeping(false)}
          onKept={(_id, message) => {
            setKeeping(false);
            toast.success(message);
          }}
        />
      )}
    </>
  );
}
