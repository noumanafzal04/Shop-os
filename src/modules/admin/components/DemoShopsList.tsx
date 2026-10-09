import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { failed } from "../../../common/api/failed";
import Button from "../../../components/ui/button/Button";
import Pager from "../../../components/ui/pager";
import { useToast } from "../../../components/ui/toast";
import { ShootingStarIcon } from "../../../icons";
import { count, money } from "../../dashboard/components/admin/format";
import { elapsedLabel } from "../../../common/time/elapsed";
import { useApproveShopRequest, useDemoShops } from "../hooks/useDemoShops";
import { ends, opened } from "./demoClock";
import { KeepDemoDialog, type DemoToKeep } from "./KeepDemoDialog";
import { Card, Empty, Person, Pill } from "./kit";

/**
 * THE SHOPS PEOPLE ARE TRYING RIGHT NOW.
 *
 * The console counted them — "Trying it 8" — and could do nothing else with
 * them: a demo reached an admin only if its visitor pressed "Keep this shop".
 * This is the list, and on each row the admin's own way to keep one.
 *
 * ── What a row has to say ──────────────────────────────────────────────
 *
 * Which one it IS. A demo has a generated name and nobody's name on it, so
 * the row says the three things that tell them apart: the name printed in the
 * demo's own header, how long ago it was opened, and what has been done in it.
 * A demo with eleven sales rung is somebody deciding; one with none is
 * somebody who looked.
 *
 * ── A demo whose owner has already asked ───────────────────────────────
 *
 * …has a sign-in of their own choosing, typed when they asked. It is offered
 * "Approve", not the form: keeping it from here would write a new password
 * over the one they picked.
 */
export function DemoShopsList() {
  const toast = useToast();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [keeping, setKeeping] = useState<DemoToKeep | null>(null);
  const rows = useDemoShops(page);
  const approve = useApproveShopRequest();

  const list = rows.data?.data ?? [];

  if (rows.isLoading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  }

  return (
    <>
      <Card>
        {list.length === 0 ? (
          <Empty
            icon={<ShootingStarIcon />}
            title="Nobody is trying a demo right now"
            hint="A demo appears here the moment somebody opens one from the front page, and clears itself away a day later."
          />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="demo-shops">
            {list.map((demo) => {
              const clock = ends(demo.demo_expires_at);

              return (
                <li
                  key={demo.id}
                  data-demo={demo.business_name}
                  // Wraps on a tablet; on a desk it is four fixed columns, so
                  // the figures line up down the page whichever rows carry a
                  // second pill or a shorter button.
                  className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 xl:grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_14rem_15rem]"
                >
                  <div className="min-w-0 flex-1 basis-56">
                    <Person
                      name={demo.business_name}
                      sub={`${demo.business_type_label ?? "No trade set"} · ${opened(demo.created_at)}`}
                    />
                  </div>

                  {/* What has been done in it. The sales are the signal. */}
                  <div className="min-w-0 basis-52 text-theme-sm">
                    <p className="font-medium tabular-nums text-gray-800 dark:text-white/90">
                      {demo.sales_count === 0
                        ? "No sale rung yet"
                        : `${count(demo.sales_count)} ${demo.sales_count === 1 ? "sale" : "sales"} · ${money(demo.sales_total)}`}
                    </p>
                    <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                      {count(demo.products_count)} {demo.products_count === 1 ? "item" : "items"} on the shelf
                      {demo.last_sale_at ? ` · last sale ${ago(demo.last_sale_at)}` : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <Pill tone={clock.tone}>{clock.text}</Pill>
                    {demo.request && <Pill tone="green">Asked to stay</Pill>}
                  </div>

                  <div className="ml-auto flex items-center gap-2.5 xl:ml-0 xl:justify-end">
                    <Link
                      to={`/admin/tenants/${demo.id}`}
                      className="text-theme-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
                    >
                      Open
                    </Link>
                    {demo.request ? (
                      <Button
                        size="sm"
                        disabled={approve.isPending}
                        onClick={() => approve.mutate(demo.request!.id, failed(toast, "That did not go through."))}
                        // Whose request it is, since the row is named for the shop.
                        aria-label={`Approve ${demo.request.contact_name}'s request for ${demo.business_name}`}
                      >
                        Approve
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setKeeping({ id: demo.id, business_name: demo.business_name })}>
                        Make it a real shop
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Pager pagination={rows.data?.meta?.pagination} onPage={setPage} noun="demo shops" />

      {keeping && (
        <KeepDemoDialog
          demo={keeping}
          onClose={() => setKeeping(null)}
          onKept={(id, message) => {
            setKeeping(null);
            toast.success(message);
            // Where the next two things are done: giving it a plan, and
            // reading back who its owner is.
            navigate(`/admin/tenants/${id}`);
          }}
        />
      )}
    </>
  );
}

/** "12m ago" · "just now" */
function ago(iso: string): string {
  const label = elapsedLabel(iso);

  return label === "just now" ? label : `${label} ago`;
}
