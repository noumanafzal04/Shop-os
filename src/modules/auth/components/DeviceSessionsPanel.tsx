import { useQuery, useQueryClient } from "@tanstack/react-query";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import { useConfirm } from "../../../components/ui/confirm";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { authService, type DeviceSession } from "../services/authService";

/**
 * Where this account is signed in — and the button that ends one.
 *
 * A shop runs on shared, cheap Android tablets that get left on counters, lent
 * out and occasionally lost. Until now the only way to deal with one was
 * "sign out everywhere", which also throws every working till off mid-queue.
 * This is the same power aimed at one device.
 *
 * The session you are reading this on is never offered for revocation: it is
 * spelled "log out", it lives in the menu, and putting it here as a red button
 * beside four others is how someone locks themselves out of the till by
 * mistake at the end of a long shift.
 */
export default function DeviceSessionsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async () => (await authService.sessions()).data,
  });

  const revoke = async (s: DeviceSession) => {
    const ok = await confirm({
      title: "Sign this device out?",
      // Say what actually happens. "Revoke session" means nothing to someone
      // holding a tablet that has stopped working.
      message: `${label(s)} will be signed out and whoever is holding it will have to log in again. Nothing they have already rung up is affected.`,
      confirmLabel: "Sign it out",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await authService.revokeSession(s.id);
      qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
      toast.success("Device signed out");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't sign that device out.");
    }
  };

  if (sessions.isPending) {
    return <div className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" />;
  }

  const rows = sessions.data ?? [];

  if (rows.length === 0) {
    return <p className="text-theme-sm text-gray-500 dark:text-gray-400">No other devices are signed in.</p>;
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {rows.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">{label(s)}</span>
              {s.is_current && <Badge size="sm" color="success">This device</Badge>}
            </div>
            <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
              {s.last_used_at ? `Last used ${ago(s.last_used_at)}` : "Never used"}
              {s.created_at ? ` · signed in ${new Date(s.created_at).toLocaleDateString()}` : ""}
            </p>
          </div>
          {!s.is_current && (
            <Button size="sm" variant="outline" onClick={() => revoke(s)}>
              Sign out
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Token names are machine-ish (`web`, `till`); give them counter words. */
function label(s: DeviceSession): string {
  const known: Record<string, string> = {
    web: "Web browser",
    till: "Till terminal",
    mobile: "Mobile app",
  };
  return known[s.device_name] ?? s.device_name;
}

/**
 * "3 hours ago" beats a timestamp here — the question being asked is "is that
 * the tablet I lost this morning?", which is about recency, not clock time.
 */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
