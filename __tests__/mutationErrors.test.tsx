import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { queryClient } from "../src/common/api/queryClient";
import { useToastStore } from "../src/common/ui/toast";
import { ApiError } from "../src/common/types/api";

/**
 * A tap that does nothing is the worst answer an app can give.
 *
 * Eleven mutations had no `onError` between them — toggling a favourite,
 * saving an address, cancelling an order. Each failed in silence, and the only
 * thing the app communicated was that the tap had not registered, so people
 * tapped again.
 *
 * The handler lives on the query client rather than on eleven mutations, which
 * is also eleven chances to forget the twelfth.
 */

const shown = () => useToastStore.getState().toasts;

async function failWith(error: unknown, meta?: Record<string, unknown>) {
  const mutation = queryClient
    .getMutationCache()
    .build(queryClient, { mutationFn: () => Promise.reject(error), meta });

  await mutation.execute(undefined).catch(() => {});
}

beforeEach(() => useToastStore.getState().clear());

describe("when a mutation fails", () => {
  it("says so, once, without anyone wiring it up", async () => {
    await failWith(new ApiError("That shop is closed.", 422));

    expect(shown()).toHaveLength(1);
    expect(shown()[0].message).toBe("That shop is closed.");
  });

  it("names the field a validation error names", async () => {
    await failWith(
      new ApiError("The given data was invalid.", 422, "VALIDATION_FAILED", {
        phone: ["Enter a Pakistani mobile number."],
      }),
    );

    // The server's sentence about the actual field beats anything this layer
    // could invent about "the given data".
    expect(shown()[0].message).toBe("Enter a Pakistani mobile number.");
  });

  it("does not read a 500 out loud", async () => {
    await failWith(new ApiError("SQLSTATE[42S02]: Base table not found", 500));

    // Server internals are for logs. They are not something a customer can act
    // on, and they are not something a customer should ever see.
    expect(shown()[0].message).not.toContain("SQLSTATE");
  });

  it("says the connection is gone when there was none", async () => {
    await failWith(new ApiError("Network request failed", 0));

    expect(shown()[0].message).toMatch(/connection/i);
  });

  it("stays quiet for a screen that reports the failure itself", async () => {
    await failWith(new ApiError("Wrong password.", 401), { silent: true });

    // Otherwise a wrong password is told twice: once under the password field
    // where it belongs, and once floating over the form being read.
    expect(shown()).toHaveLength(0);
  });
});

describe("the screens that opt out actually do", () => {
  it.each([
    ["useLogin", "src/modules/auth/hooks/useAuth.ts"],
    ["usePlaceOrder", "src/modules/orders/hooks/useOrders.ts"],
    ["useRegisterCustomer", "src/modules/marketplace/hooks/useMarketplace.ts"],
    ["useReserve", "src/modules/marketplace/hooks/useMarketplace.ts"],
  ])("%s is marked silent", (fn, file) => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, file), "utf8");
    const body = src.slice(src.indexOf(`export function ${fn}(`));
    const mutation = body.slice(0, body.indexOf("\n}"));

    expect(mutation).toContain("meta: { silent: true }");
  });

  it("has no OTHER mutation quietly opting out", () => {
    // The opt-out is for screens that show the failure in place. Anywhere else
    // it is the silence this whole handler exists to end.
    const allowed = ["useLogin", "usePlaceOrder", "useRegisterCustomer", "useReserve"];

    const files = sourceFiles(path.join(PROJECT_ROOT, "src"));
    expect(files.length).toBeGreaterThan(30);

    const rogue = files.flatMap((f) => {
      const src = fs.readFileSync(f, "utf8");
      if (!src.includes("silent: true")) return [];
      return [...src.matchAll(/export function (use\w+)\(/g)]
        .map((m) => m[1])
        .filter((name) => !allowed.includes(name))
        .filter((name) => {
          const body = src.slice(src.indexOf(`export function ${name}(`));
          return body.slice(0, body.indexOf("\n}")).includes("silent: true");
        })
        .map((name) => `  ${path.relative(PROJECT_ROOT, f)}  ${name}`);
    });

    expect(rogue.join("\n")).toBe("");
  });
});
