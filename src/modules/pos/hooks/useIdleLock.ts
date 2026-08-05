import { useEffect, useRef } from "react";
import { useTillStore } from "../../../stores/tillStore";

/**
 * Lock the till after a quiet spell.
 *
 * The counter's own activity is the clock — a pointer, a key, a barcode scan
 * (which arrives as keystrokes) all count. The timer is checked on an interval
 * rather than re-armed on every event, so a busy till doesn't churn through
 * thousands of timeouts a minute.
 *
 * `minutes <= 0` means never, which is the shipped default: a one-person shop
 * being asked for a PIN between customers is a worse problem than the one this
 * solves.
 */
export function useIdleLock(minutes: number, enabled = true): void {
  const lock = useTillStore((s) => s.lock);
  const locked = useTillStore((s) => s.locked);
  const lastRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled || minutes <= 0 || locked) return;

    lastRef.current = Date.now();
    const bump = () => { lastRef.current = Date.now(); };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    const tick = window.setInterval(() => {
      if (Date.now() - lastRef.current >= minutes * 60_000) lock("idle");
    }, 15_000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(tick);
    };
  }, [enabled, minutes, locked, lock]);
}
