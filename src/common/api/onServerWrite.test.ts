import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AxiosError } from "axios";

import { api, apiDelete, apiGet, apiPatch, apiPost, apiPut, onServerWrite } from "./client";
import { useAuthStore } from "../../stores/authStore";

/**
 * "THIS DEVICE JUST CHANGED SOMETHING" — said at the one place every write
 * passes.
 *
 * The till listens to this to bring its own catalogue up to date after a
 * save made at this counter (`useKeepInSync`). It is told here, and not by
 * each screen that saves, so a screen built next year is covered on the day
 * it is written.
 */

const answered = { success: true, message: "", data: null, errors: {}, meta: {} };
let heard: string[];
let stop: () => void;

beforeEach(() => {
  useAuthStore.setState({ user: { id: "u1" } as never, accessToken: "token", refreshToken: null, isAuthenticated: true });
  api.defaults.adapter = async (config) => ({ data: answered, status: 200, statusText: "OK", headers: {}, config }) as never;
  heard = [];
  stop = onServerWrite((method, path) => heard.push(`${method} ${path}`));
});

afterEach(() => {
  stop();
  delete api.defaults.adapter;
});

describe("a write the server accepted", () => {
  it("is told, with how and where — for every kind of write", async () => {
    await apiPost("/products", { name: "Kurta" });
    await apiPut("/products/7", { name: "Kurta, white" });
    await apiPatch("/pos-devices/3", { name: "Counter" });
    await apiDelete("/products/7");

    expect(heard).toEqual(["post /products", "put /products/7", "patch /pos-devices/3", "delete /products/7"]);
  });

  it("is told to everybody listening", async () => {
    const second: string[] = [];
    const stopSecond = onServerWrite((method, path) => second.push(`${method} ${path}`));

    await apiPost("/categories", { name: "Men" });
    stopSecond();

    expect(heard).toEqual(["post /categories"]);
    expect(second).toEqual(["post /categories"]);
  });
});

describe("what is not a write", () => {
  it("a read is never told — or every screen that opens would be news", async () => {
    await apiGet("/products");
    await apiGet("/shop/settings");

    expect(heard).toEqual([]);
  });

  it("a write the server REFUSED changed nothing, and is not told", async () => {
    api.defaults.adapter = async (config) => {
      const refused = new AxiosError("Unprocessable", "ERR_BAD_REQUEST", config as never);
      refused.response = { status: 422, data: { ...answered, success: false, message: "The name is taken." }, statusText: "", headers: {}, config } as never;
      throw refused;
    };

    await expect(apiPost("/products", { name: "Kurta" })).rejects.toThrow("The name is taken.");

    expect(heard).toEqual([]);
  });

  it("a write that never reached the server is not told", async () => {
    api.defaults.adapter = async (config) => {
      throw new AxiosError("Network Error", "ERR_NETWORK", config as never);
    };

    await expect(apiPost("/products", { name: "Kurta" })).rejects.toThrow();

    expect(heard).toEqual([]);
  });
});

describe("a listener", () => {
  it("is not told after it has stopped listening", async () => {
    stop();

    await apiPost("/products", { name: "Kurta" });

    expect(heard).toEqual([]);
  });

  it("that throws does not fail the save it was told about, nor silence the others", async () => {
    stop();
    const stopBroken = onServerWrite(() => {
      throw new Error("a listener's own trouble");
    });
    stop = onServerWrite((method, path) => heard.push(`${method} ${path}`));

    await expect(apiPost("/products", { name: "Kurta" })).resolves.toMatchObject({ success: true });
    stopBroken();

    expect(heard).toEqual(["post /products"]);
  });
});
