import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useConnectionStore } from "../../../stores/connectionStore";
import TillLock from "./TillLock";

/**
 * A LOCK NOBODY CAN OPEN IS NOT SECURITY, IT IS A SHUTTER.
 *
 * Both halves of this screen belong to the server: the list of who may unlock,
 * and the PIN check. There is no PIN on the device to check one against —
 * deliberately, because a PIN mirrored into IndexedDB is a PIN anybody holding
 * the tablet can read.
 *
 * So a till locked during an outage could not be opened until the line came
 * back: a working till, offline selling switched on, a queue of customers, and
 * no way in. `PosPage` no longer locks while the line is down; this covers the
 * till that was already locked when it went, and the escape hatch underneath —
 * which signs the till OUT, through the same server, and would close the last
 * door behind them.
 */

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("../services/tillService", () => ({
  tillService: {
    roster: async () => ({ data: [] }),
    unlock: async () => {
      throw new Error("network");
    },
  },
}));

function wrap(node: ReactNode): ReactNode {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

beforeEach(() => {
  useConnectionStore.setState({ online: true, reachable: true });
});

describe("the till lock with the line down", () => {
  it("does not offer the sign-out escape, which needs the same server", () => {
    useConnectionStore.setState({ online: false, reachable: false });
    render(wrap(<TillLock />));

    const escape = screen.getByRole("button", { name: /waiting for the connection/i });

    expect(
      escape,
      "the offline lock screen still offers to sign the till out — and it could not sign back in",
    ).toBeDisabled();
  });

  it("still offers it when the server can be reached", () => {
    render(wrap(<TillLock />));

    const escape = screen.getByRole("button", { name: /sign in with a password/i });

    expect(escape, "the escape hatch is gone when the line is up").toBeEnabled();
  });
});
