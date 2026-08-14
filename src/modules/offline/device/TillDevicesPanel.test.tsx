import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import TillDevicesPanel from "./TillDevicesPanel";
import { deviceService, type PosDevice } from "./deviceService";
import { useOfflineStore } from "../offlineStore";

/**
 * The owner's answer to "which tills are signed in, and how do I stop the one
 * that walked out of the door".
 *
 * The load-bearing behaviour is that signing a till out is NOT a delete. The
 * sales that device already sent still point at it, and the row is what an
 * owner reads afterwards to work out what happened — so a signed-out till stays
 * on the list, marked, with a way back.
 */

vi.mock("../../../components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const device = (over: Partial<PosDevice> = {}): PosDevice => ({
  id: "d1",
  name: "Counter tablet",
  platform: "web",
  branch: { id: "b1", name: "Main" },
  register: { id: "r1", name: "Lane 1" },
  last_seen_at: new Date().toISOString(),
  days_offline: 0,
  revoked: false,
  revoked_at: null,
  ...over,
});

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <TillDevicesPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  useOfflineStore.setState({ deviceId: null, registrationRefusal: null });
});

describe("the roster", () => {
  it("lists each till with its lane and when it last reached us", async () => {
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device()], offline_days: 3 }),
    );

    renderPanel();

    expect(await screen.findByText("Counter tablet")).toBeInTheDocument();
    expect(screen.getByText(/Lane 1 · Main/)).toBeInTheDocument();
    expect(screen.getByText(/just now/)).toBeInTheDocument();
  });

  it("marks the device you are reading this on", async () => {
    useOfflineStore.setState({ deviceId: "d1" });
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device()], offline_days: 3 }),
    );

    renderPanel();

    expect(await screen.findByText("This device")).toBeInTheDocument();
  });

  it("says how long a till may sell out of contact — and that nothing is lost", async () => {
    // The sentence that stops a support call. The window limits SELLING; it
    // never limits syncing, and an owner must be told so plainly.
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device()], offline_days: 3 }),
    );

    renderPanel();

    expect(await screen.findByText(/up to/)).toBeInTheDocument();
    expect(screen.getByText(/never lost/)).toBeInTheDocument();
    expect(screen.getByText(/however long that takes/)).toBeInTheDocument();
  });

  it("explains itself when a shop has no tills yet", async () => {
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [], offline_days: 3 }),
    );

    renderPanel();

    expect(await screen.findByText(/No tills yet/)).toBeInTheDocument();
  });

  it("says so when the list cannot be loaded", async () => {
    vi.spyOn(deviceService, "list").mockRejectedValue(new Error("nope"));

    renderPanel();

    expect(await screen.findByText(/Couldn't load your tills/)).toBeInTheDocument();
  });
});

describe("signing a till out", () => {
  it("calls revoke, not delete", async () => {
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device()], offline_days: 3 }),
    );
    const revoke = vi
      .spyOn(deviceService, "revoke")
      .mockResolvedValue(envelope(device({ revoked: true })));

    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(revoke).toHaveBeenCalledWith("d1"));
  });

  it("keeps a signed-out till on the list, marked, with a way back", async () => {
    // Not a delete. Its sales still point at it, and why it was signed out is
    // exactly what an owner comes here to read.
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({
        devices: [device({ revoked: true, revoked_at: new Date().toISOString() })],
        offline_days: 3,
      }),
    );

    renderPanel();

    expect(await screen.findByText("Counter tablet")).toBeInTheDocument();
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /allow again/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sign out$/i })).toBeNull();
  });

  it("lets a till that turned up be allowed back", async () => {
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device({ revoked: true })], offline_days: 3 }),
    );
    const restore = vi
      .spyOn(deviceService, "restore")
      .mockResolvedValue(envelope(device({ revoked: false })));

    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /allow again/i }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith("d1"));
  });
});

describe("how long ago", () => {
  it.each([
    ["just now", 30_000],
    ["45 minutes ago", 45 * 60_000],
    ["3 hours ago", 3 * 3_600_000],
    ["1 hour ago", 1 * 3_600_000],
    ["5 days ago", 5 * 24 * 3_600_000],
    ["1 day ago", 25 * 3_600_000],
  ])("reads %s", async (expected, agoMs) => {
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({
        devices: [device({ last_seen_at: new Date(Date.now() - agoMs).toISOString() })],
        offline_days: 3,
      }),
    );

    renderPanel();

    expect(await screen.findByText(new RegExp(expected))).toBeInTheDocument();
  });

  it("says 'never' rather than inventing a date", async () => {
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device({ last_seen_at: null })], offline_days: 3 }),
    );

    renderPanel();

    // Scoped: the window sentence above also contains the word "never"
    // ("sales already rung are never lost"), and a bare /never/ matches both.
    expect(await screen.findByText(/reached us never/)).toBeInTheDocument();
  });
});

describe("naming a till", () => {
  // Not cosmetic. The offline report puts this name against every late sale,
  // because a fault on ONE tablet is a different problem from a fault in the
  // shop — and three tills all reading "Unnamed till" make that column say
  // nothing at all.

  const promptWith = (answer: string | null): void => {
    vi.spyOn(window, "prompt").mockReturnValue(answer);
  };

  it("renames through the endpoint that does NOT touch last-seen", async () => {
    // `register(id, name)` would work and would also stamp "reached us just
    // now" onto a tablet that has been switched off for a week — corrupting
    // the one column this whole screen exists to show.
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device()], offline_days: 3 }),
    );
    const rename = vi.spyOn(deviceService, "rename").mockResolvedValue(envelope(device()));
    const register = vi.spyOn(deviceService, "register");
    promptWith("Lane 2");

    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /rename/i }));

    await waitFor(() => expect(rename).toHaveBeenCalledWith("d1", "Lane 2"));
    expect(register).not.toHaveBeenCalled();
  });

  it("invites a name on a till that has none", async () => {
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device({ name: null })], offline_days: 3 }),
    );

    renderPanel();

    expect(await screen.findByRole("button", { name: /name it/i })).toBeInTheDocument();
  });

  it("does nothing when the box is cancelled", async () => {
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device()], offline_days: 3 }),
    );
    const rename = vi.spyOn(deviceService, "rename");
    promptWith(null);

    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /rename/i }));

    expect(rename).not.toHaveBeenCalled();
  });

  it("refuses to blank a name somebody typed", async () => {
    // Emptying the box is a slip, not a request to go back to "Unnamed till".
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [device()], offline_days: 3 }),
    );
    const rename = vi.spyOn(deviceService, "rename");
    promptWith("   ");

    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /rename/i }));

    expect(rename).not.toHaveBeenCalled();
  });
});

describe("a device the server turned away", () => {
  // "No tills yet" is true of a shop nobody has opened ShopOS on. It is a LIE
  // to a shop whose device announced itself and was refused — and that owner
  // is looking straight at the device while the screen says it does not exist.

  it("shows the server's reason instead of 'no tills yet'", async () => {
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [], offline_days: 3 }),
    );
    useOfflineStore.setState({
      registrationRefusal: "That device is registered to another shop.",
    });

    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(/registered to another shop/);
    expect(screen.queryByText(/No tills yet/)).not.toBeInTheDocument();
  });

  it("still says 'no tills yet' when nothing was refused", async () => {
    // A genuinely new shop must not be shown an alarm.
    vi.spyOn(deviceService, "list").mockResolvedValue(
      envelope({ devices: [], offline_days: 3 }),
    );

    renderPanel();

    expect(await screen.findByText(/No tills yet/)).toBeInTheDocument();
  });
});
