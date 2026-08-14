import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useOfflineStore } from "../offlineStore";
import { deviceService, type PosDevice } from "./deviceService";

/**
 * The tills this shop actually runs on.
 *
 * Answers three questions an owner asks and currently cannot: which devices are
 * signed in, when each last reached us, and how to stop the one that walked out
 * of the door.
 *
 * Signing a till out is not a delete. The sales it already sent still point at
 * it, and the row is what an owner reads afterwards to work out what happened —
 * so a signed-out till stays on the list, greyed, with a way back.
 */

/** "3 days ago", "2 hours ago" — the only precision that matters here. */
function lastSeen(device: PosDevice): string {
  if (device.last_seen_at === null) return "never";

  const ms = Date.now() - new Date(device.last_seen_at).getTime();
  const minutes = Math.floor(ms / 60_000);

  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function TillDevicesPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const thisDevice = useOfflineStore((s) => s.deviceId);
  const refusal = useOfflineStore((s) => s.registrationRefusal);

  const roster = useQuery({
    queryKey: ["pos-devices"],
    queryFn: () => deviceService.list().then((r) => r.data),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["pos-devices"] });

  const revoke = useMutation({
    mutationFn: (id: string) => deviceService.revoke(id),
    onSuccess: () => {
      toast.success("Till signed out. It can't be used until you allow it again.");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't sign that till out."),
  });

  const restore = useMutation({
    mutationFn: (id: string) => deviceService.restore(id),
    onSuccess: () => {
      toast.success("Till allowed again.");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't allow that till."),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => deviceService.rename(id, name),
    onSuccess: () => {
      toast.success("Till renamed.");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't rename that till."),
  });

  // A prompt rather than an inline field, deliberately. This is a list an owner
  // opens perhaps twice a year — once when a tablet arrives and once when one
  // goes missing — and an edit affordance on every row would compete for
  // attention with the button that actually matters, which is Sign out.
  const askName = (device: PosDevice): void => {
    const next = window.prompt(
      "What is this till called? Use the name the staff use — \"Counter tablet\", \"Lane 2\".",
      device.name ?? "",
    );

    // Cancel returns null; an empty box is somebody clearing it, and going back
    // to "Unnamed till" is never what they meant.
    if (next === null || next.trim() === "") return;

    rename.mutate({ id: device.id, name: next.trim() });
  };

  if (roster.isLoading) {
    return <p className="text-theme-sm text-gray-400">Loading tills…</p>;
  }

  if (roster.isError) {
    return (
      <p className="text-theme-sm text-error-500">
        {roster.error instanceof ApiError ? roster.error.message : "Couldn't load your tills."}
      </p>
    );
  }

  const devices = roster.data?.devices ?? [];
  const windowDays = roster.data?.offline_days ?? null;

  if (devices.length === 0) {
    // "No tills yet" is true of a shop nobody has opened ShopOS on. It is a LIE
    // to a shop whose device announced itself and was turned away — signed out,
    // or already registered to another shop — and that owner is looking at the
    // device while the screen tells them it does not exist. The server sends a
    // sentence with each refusal; this is where it has to land.
    if (refusal !== null) {
      return (
        <div
          role="alert"
          className="rounded-xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/10"
        >
          <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
            This device could not sign itself in
          </p>
          <p className="mt-1 text-theme-xs text-gray-600 dark:text-gray-300">{refusal}</p>
        </div>
      );
    }

    return (
      <p className="text-theme-sm text-gray-400">
        No tills yet. Every device that opens ShopOS signs itself in here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {windowDays !== null && (
        <p className="text-theme-xs text-gray-400">
          A till in this shop may keep selling for up to{" "}
          <span className="font-medium text-gray-600 dark:text-gray-300">
            {windowDays} day{windowDays === 1 ? "" : "s"}
          </span>{" "}
          without reaching us. Ask support to change it. Sales already rung are never lost — they
          send themselves whenever the till next gets a connection, however long that takes.
        </p>
      )}

      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {devices.map((device) => {
          const isThis = device.id === thisDevice;

          return (
            <div key={device.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`truncate text-theme-sm font-medium ${
                      device.revoked
                        ? "text-gray-400 line-through"
                        : "text-gray-800 dark:text-white/90"
                    }`}
                  >
                    {device.name ?? "Unnamed till"}
                  </span>
                  {/* Named, not decorated. The offline report puts this against
                      every late sale, because a fault on ONE tablet is a
                      different problem from a fault in the shop — and three
                      tills all reading "Unnamed till" make that column say
                      nothing at all. */}
                  <button
                    type="button"
                    onClick={() => askName(device)}
                    disabled={rename.isPending}
                    className="text-theme-xs text-brand-500 hover:underline disabled:opacity-50"
                  >
                    {device.name === null ? "Name it" : "Rename"}
                  </button>
                  {isThis && (
                    <Badge size="sm" color="info">
                      This device
                    </Badge>
                  )}
                  {device.revoked && (
                    <Badge size="sm" color="light">
                      Signed out
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-theme-xs text-gray-400">
                  {[device.register?.name, device.branch?.name].filter(Boolean).join(" · ") ||
                    "No lane picked"}
                  {" — last reached us "}
                  {lastSeen(device)}
                </p>
              </div>

              {device.revoked ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => restore.mutate(device.id)}
                  disabled={restore.isPending}
                >
                  Allow again
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => revoke.mutate(device.id)}
                  disabled={revoke.isPending}
                >
                  Sign out
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
