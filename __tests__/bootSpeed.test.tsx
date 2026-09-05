import ReactTestRenderer from "react-test-renderer";
import React from "react";

/**
 * The splash screen ends when the PHONE answers, not when the SERVER does.
 *
 * An access token lives one hour, so the ordinary case — opening the app the
 * next morning — used to be: `/auth/me` 401s after up to twenty seconds, the
 * client spends up to another twenty refreshing, and the person watches a logo
 * for the whole of it. Measured at about three minutes over a slow connection,
 * with nothing on screen to press.
 *
 * The rule is therefore about ORDER, and a test that waits for the network
 * cannot express it. This one makes `me()` a promise that NEVER settles: if
 * the status leaves "booting" anyway, the session is not gated on the server.
 */

const mockMe = jest.fn(() => new Promise(() => {}));

jest.mock("../src/modules/auth/services/authService", () => ({
  ...jest.requireActual("../src/modules/auth/services/authService"),
  authService: {
    ...jest.requireActual("../src/modules/auth/services/authService").authService,
    me: () => mockMe(),
  },
}));

const mockHydrate = jest.fn(() => Promise.resolve(true));

import { useAuthStore } from "../src/stores/authStore";
import { useBootstrapSession } from "../src/modules/auth/hooks/useAuth";

function Boot() {
  useBootstrapSession();
  return null;
}

beforeEach(() => {
  mockMe.mockClear();
  useAuthStore.setState({
    status: "booting",
    user: null,
    accessToken: null,
    refreshToken: null,
    hydrateTokens: mockHydrate,
  } as never);
});

describe("opening the app", () => {
  it("leaves the splash as soon as tokens are found, before the server answers", async () => {
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(<Boot />);
      // Let the Keychain read settle — and only that.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useAuthStore.getState().status).toBe("authenticated");
    // The profile request went out; it simply is not being waited on.
    expect(mockMe).toHaveBeenCalledTimes(1);
  });

  it("is a guest when there are no tokens at all", async () => {
    mockHydrate.mockResolvedValueOnce(false);

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(<Boot />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useAuthStore.getState().status).toBe("guest");
    // Nothing to ask about, so nothing is asked.
    expect(mockMe).not.toHaveBeenCalled();
  });

  it("does not strand the app when the Keychain itself throws", async () => {
    mockHydrate.mockRejectedValueOnce(new Error("keystore unavailable"));

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(<Boot />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // A phone that cannot answer is not a decision, and it must never be the
    // reason the app never opens.
    expect(useAuthStore.getState().status).toBe("guest");
  });
});
