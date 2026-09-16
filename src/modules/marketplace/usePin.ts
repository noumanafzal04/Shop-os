import { useCallback, useState } from "react";
import { useAddresses } from "./hooks/useMarketplace";

/**
 * WHERE THE SHOPPER IS, on the web.
 *
 * ── The gap this closes ────────────────────────────────────────────────
 *
 * The phone has had a pin since the marketplace shipped: it fences the shop
 * list, the aisle and the home feed, it orders by distance, and it is what
 * puts "Delivers to you" on a card. The web had a CITY DROPDOWN, defaulting to
 * "All cities", and sent no coordinates anywhere.
 *
 * So three things were true of cartze.shop and of nothing else:
 *
 *   · a shop that delivers 5 km was listed to somebody in another city,
 *     opened, filled with a basket, and refused at the checkout — the exact
 *     failure the radius fence was built to prevent, still live on one of the
 *     two front doors;
 *   · no card could say how far away anything was;
 *   · and a web order carried no destination, so the fence was never even
 *     measured for it and the rider got an address with no map behind it.
 *
 * ── Where the pin comes from, in order ─────────────────────────────────
 *
 * 1. The customer's DEFAULT SAVED ADDRESS, if it has coordinates. This is the
 *    best answer by a distance: it is where they actually want the order, it
 *    survives every device, and it needed no permission prompt.
 * 2. A pin this browser was given once, remembered in `localStorage`.
 * 3. Nothing — and nothing is a valid answer. The city dropdown still works,
 *    the lists are unfenced exactly as they are today, and no page breaks.
 *    A location is an improvement, never a gate.
 *
 * ── Why the browser is never asked on its own ──────────────────────────
 *
 * `navigator.geolocation` opens a permission prompt, and a prompt that appears
 * because a page loaded is a prompt people deny — after which the browser
 * remembers the denial and the feature is gone for good. So it is only ever
 * called from `locate()`, which is a control somebody pressed.
 */
export interface Pin {
  lat: number | null;
  lng: number | null;
  /** True while the browser is being asked. */
  locating: boolean;
  /** Ask the browser. Only ever called from a control. */
  locate: () => void;
  /** Throw the remembered pin away. */
  forget: () => void;
}

/**
 * The remembered pin's key.
 *
 * A NEW key, not a rename of one of the storage keys the offline till depends
 * on — those may never move. `market` rather than `shop` because this is the
 * shopper's location and not the business's.
 */
const KEY = "shopos-market-pin";

interface Stored {
  lat: number;
  lng: number;
}

function remembered(): Stored | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;

    // Both, and both numbers. A half-written pin is worse than none: it
    // becomes `lat=31&lng=NaN`, which the server validates as a bad request
    // and the whole list disappears.
    return typeof parsed.lat === "number" && typeof parsed.lng === "number"
      ? { lat: parsed.lat, lng: parsed.lng }
      : null;
  } catch {
    // Private mode, disabled storage, a corrupt value. None of them is a
    // reason a shopper cannot browse.
    return null;
  }
}

export function usePin(signedIn: boolean): Pin {
  const addresses = useAddresses(signedIn);
  const [browserPin, setBrowserPin] = useState<Stored | null>(() => remembered());
  const [locating, setLocating] = useState(false);

  // The saved address wins, and it wins even after the browser has been asked:
  // "where I want this delivered" beats "where this laptop is" every time, and
  // somebody ordering to their mother's house from the office is the case that
  // makes the difference obvious.
  const saved = (addresses.data ?? []).find((a) => a.is_default) ?? (addresses.data ?? [])[0];
  const fromAddress =
    saved && saved.latitude != null && saved.longitude != null
      ? { lat: saved.latitude, lng: saved.longitude }
      : null;

  const pin = fromAddress ?? browserPin;

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude };
        setBrowserPin(next);
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          // Not remembering it is not worth interrupting anybody over; the
          // pin is still correct for this visit.
        }
        setLocating(false);
      },
      () => setLocating(false),
      // Ten seconds, and a cached fix up to five minutes old is fine — this
      // decides which shops are listed, not where a rider is right now.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  const forget = useCallback(() => {
    setBrowserPin(null);
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* see above */
    }
  }, []);

  return {
    lat: pin?.lat ?? null,
    lng: pin?.lng ?? null,
    locating,
    locate,
    forget,
  };
}
