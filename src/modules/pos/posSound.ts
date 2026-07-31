// Short POS feedback tones via the Web Audio API — no audio files, no network,
// nothing to bundle. A rising two-note chirp on a successful scan/add and a low
// square-wave buzz on a rejection (not found / out of stock). Honours a
// persisted mute (localStorage "pos_sound_muted") so a cashier can silence it.

const MUTE_KEY = "pos_sound_muted";

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    // A backgrounded tab suspends the context; the current click/scan gesture
    // is enough to resume it.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, startAt: number, duration: number, type: OscillatorType = "sine", peak = 0.07): void {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ac.currentTime + startAt;
  // Quick attack + exponential decay = a clean blip with no click at the edges.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const posSound = {
  isMuted(): boolean {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  },
  setMuted(muted: boolean): void {
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* storage unavailable — sound just stays at its default */
    }
  },
  /** Rising A5 → E6 chirp: item recognised / added. */
  success(): void {
    if (this.isMuted()) return;
    tone(880, 0, 0.09);
    tone(1318.5, 0.08, 0.12);
  },
  /** Low square-wave buzz: not found / out of stock / rejected. */
  error(): void {
    if (this.isMuted()) return;
    tone(196, 0, 0.26, "square", 0.09);
  },
};
