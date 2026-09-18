import { Platform } from "react-native";

/**
 * Which backend this app talks to.
 *
 * A copy of the customer app's, minus the map keys — this app has none, and a
 * shop does not move. The two files are allowed to be copies: an address is
 * not shared logic, and the day Partner points somewhere else it must be able
 * to without touching the other app.
 *
 * `"auto"`   a debug build talks to the machine that built it; a release build
 *            talks to production. The normal case.
 * `"live"`   a debug build talks to PRODUCTION — real shops, real orders. An
 *            order advanced here is an order a shop has to honour.
 * `"tunnel"` a debug build talks to `TUNNEL_URL` — a phone on mobile data
 *            reaching a laptop, via ngrok or trycloudflare.
 */
type ApiTarget = "auto" | "live" | "tunnel";

// Cast, not an annotation: TypeScript narrows `const x: "a" | "b" = "a"` to the
// literal it was given and then calls every other branch dead code. The point
// of this line is that it gets edited.
const API_TARGET = "auto" as ApiTarget;

/**
 * PRODUCTION.
 *
 * An ADDRESS, deliberately a literal. `panel.cartze.shop` is the WEB PANEL and
 * answers /api/* with its own HTML — a 200 that is not the API. This host is
 * the one that serves it.
 */
const PROD_URL = "https://cartze.shop/api/v1";

/** Changes every time the tunnel restarts. Only read when API_TARGET is "tunnel". */
const TUNNEL_URL = "";

/**
 * Dev API host differs per platform:
 *  - iOS simulator reaches the Mac's localhost directly
 *  - Android emulator reaches it via 10.0.2.2
 * A real device on the same Wi-Fi needs the tunnel, not an edit here, so the
 * platform mapping stays correct.
 */
const DEV_HOST = Platform.select({
  ios: "http://localhost:8000",
  android: "http://10.0.2.2:8000",
  default: "http://localhost:8000",
});

export const API_BASE_URL =
  API_TARGET === "live"
    ? PROD_URL
    : API_TARGET === "tunnel" && TUNNEL_URL
      ? `${TUNNEL_URL}/api/v1`
      : __DEV__
        ? `${DEV_HOST}/api/v1`
        : PROD_URL;
