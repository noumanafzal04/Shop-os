import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useConnectionStore } from "../../../stores/connectionStore";
import { useAuthStore } from "../../../stores/authStore";
import { useTillStore } from "../../../stores/tillStore";
import { useTerminalStore } from "../../../stores/terminalStore";
import { ApiError } from "../../../common/types/api";
import { tillService, type TillUser } from "../services/tillService";

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

/**
 * The lock screen.
 *
 * It covers the till and nothing else — the point is not to protect data (the
 * browser still holds a session) but to stop the next person who walks up from
 * ringing a sale under the last person's name. Every control built in Units 6
 * and 7 — the per-cashier drawer, the void report, the discount ceiling —
 * assumes the name on the sale is the person who made it, and on a shared
 * terminal that assumption is false by mid-morning without this.
 *
 * There is always a way out: someone with no PIN, or a frozen one, can sign in
 * with a password. A lock the counter cannot get past would just be propped
 * open permanently.
 */
export default function TillLock() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clear);
  const unlockTill = useTillStore((s) => s.unlock);
  const reason = useTillStore((s) => s.reason);
  const laneName = useTerminalStore((s) => s.activeRegisterName);

  // Both halves of this screen are the server's: the list of who may unlock,
  // and the PIN check itself. There is no PIN on this device to check one
  // against — deliberately, because a PIN mirrored into IndexedDB is a PIN
  // anybody with the tablet can read. So while the line is down this screen
  // cannot do its job, and the honest thing is to say which door is shut
  // rather than accept six digits and answer "Couldn't unlock. Try again." to
  // every one of them.
  //
  // The till no longer locks itself while offline (see PosPage), so this is
  // for the till that was ALREADY locked when the line went — a shift change
  // during a power cut.
  const connected = useConnectionStore((c) => c.online && c.reachable);

  const roster = useQuery({
    queryKey: ["pos", "till-users"],
    queryFn: async () => (await tillService.roster()).data,
    staleTime: 60_000,
  });

  // Default to whoever is signed in: the common case is the same person coming
  // back from a break, not a handover.
  const [selectedId, setSelectedId] = useState<string | null>(currentUser?.id ?? null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);

  const users = useMemo(() => {
    const list = roster.data ?? [];
    // Current user first, then everyone else alphabetically (already sorted).
    return [...list].sort((a, b) => (a.id === currentUser?.id ? -1 : b.id === currentUser?.id ? 1 : 0));
  }, [roster.data, currentUser?.id]);

  const selected: TillUser | undefined = users.find((u) => u.id === selectedId) ?? users[0];

  useEffect(() => {
    if (!selectedId && users.length > 0) setSelectedId(users[0].id);
  }, [users, selectedId]);

  // Keep focus on the pad so a physical numeric keypad — which every counter
  // has — works without touching the screen.
  useEffect(() => { padRef.current?.focus(); }, []);

  const submit = async () => {
    if (!selected || pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await tillService.unlock(selected.id, pin);
      if (data.switched && data.access_token && data.refresh_token) {
        setAuth(data.user, data.access_token, data.refresh_token);
      }
      setPin("");
      unlockTill();
    } catch (e) {
      setPin("");
      setError(
        connected
          ? e instanceof ApiError
            ? e.message
            : "Couldn't unlock. Try again."
          : "The till can't check a PIN with the connection down. Wait for the line to come back — the sales already saved on this device are safe and will send themselves.",
      );
      roster.refetch(); // a freeze may have just happened — refresh the badges
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    setError(null);
    setPin((p) => (p.length >= 6 ? p : p + d));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); return; }
    if (e.key === "Backspace") { setPin((p) => p.slice(0, -1)); e.preventDefault(); return; }
    if (e.key === "Enter") { void submit(); e.preventDefault(); }
  };

  /** No PIN, or a frozen one — the password screen is the way back in. */
  const signInInstead = () => {
    clearAuth();
    unlockTill();
    navigate("/signin", { replace: true });
  };

  return (
    <div
      ref={padRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100000] flex flex-col items-center justify-center overflow-y-auto bg-gray-900/95 p-6 outline-none backdrop-blur-sm"
    >
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-theme-xs uppercase tracking-widest text-gray-400">
            {laneName ? `${laneName} · locked` : "Till locked"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Who's at the counter?</h2>
          <p className="mt-1 text-theme-sm text-gray-400">
            {reason === "idle"
              ? "Locked after a quiet spell — enter a PIN to carry on."
              : "Enter your PIN to carry on, or pick someone else to hand over."}
          </p>
        </div>

        {/* Roster */}
        <div className="mb-5 flex flex-wrap justify-center gap-2">
          {roster.isLoading && <div className="h-16 w-full animate-pulse rounded-xl bg-white/10" />}
          {users.map((u) => {
            const active = u.id === selected?.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => { setSelectedId(u.id); setPin(""); setError(null); padRef.current?.focus(); }}
                className={`flex min-w-[92px] flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition ${
                  active
                    ? "border-brand-400 bg-brand-500/20"
                    : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                  active ? "bg-brand-500 text-white" : "bg-white/10 text-gray-200"
                }`}>
                  {initials(u.name)}
                </span>
                <span className="max-w-[80px] truncate text-theme-xs font-medium text-gray-200">{u.name}</span>
                {!u.has_pin && <span className="text-[10px] text-gray-500">no PIN</span>}
                {u.pin_locked && <span className="text-[10px] text-error-400">locked</span>}
              </button>
            );
          })}
        </div>

        {/* PIN dots */}
        <div className="mb-4 flex justify-center gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full transition ${
                i < pin.length ? "bg-brand-400" : i < 4 ? "bg-white/25" : "bg-white/10"
              }`}
            />
          ))}
        </div>

        {error && <p className="mb-3 text-center text-theme-sm text-error-400">{error}</p>}
        {selected && !selected.has_pin && !error && (
          <p className="mb-3 text-center text-theme-sm text-gray-400">
            {selected.name} has no till PIN yet — set one in Settings, or sign in with a password.
          </p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => press(d)}
              className="rounded-xl bg-white/10 py-4 text-xl font-semibold text-white transition hover:bg-white/20 active:bg-white/30"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPin((p) => p.slice(0, -1))}
            className="rounded-xl bg-white/5 py-4 text-theme-sm font-medium text-gray-300 transition hover:bg-white/10"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => press("0")}
            className="rounded-xl bg-white/10 py-4 text-xl font-semibold text-white transition hover:bg-white/20 active:bg-white/30"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pin.length < 4 || busy || !selected}
            className="rounded-xl bg-brand-500 py-4 text-theme-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "…" : "Unlock"}
          </button>
        </div>

        {/* Offline this is a TRAP, not an escape. It signs the till out — and
            signing back in is the same server that cannot check the PIN, so
            the one door left would close behind them. The queue in IndexedDB
            survives, but nothing can send it without a token. So it is shut
            while the line is down, and says so. */}
        <button
          type="button"
          onClick={signInInstead}
          disabled={!connected}
          title={
            connected
              ? undefined
              : "Signing out needs the connection too — you would not be able to sign back in until the line is back."
          }
          className="mt-5 w-full text-center text-theme-sm text-gray-400 underline-offset-2 transition hover:text-white hover:underline disabled:cursor-not-allowed disabled:text-gray-600 disabled:no-underline disabled:hover:text-gray-600"
        >
          {connected ? "Sign in with a password instead" : "Waiting for the connection…"}
        </button>
      </div>
    </div>
  );
}
