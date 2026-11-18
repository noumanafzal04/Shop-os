import { PROJECT_ROOT, fs, path } from "./support/node";

/**
 * SIGNING IN MAKES EVERY GUEST-ERA ANSWER STALE.
 *
 * Checkout fetched the saved addresses while the shopper was still a guest —
 * none — and that empty list stayed fresh in the cache. They signed in to pay
 * and were told to "Add an address" while their Home address sat on the
 * server. Both doors into a session must mark the cache stale AFTER the
 * session exists, or the refetch goes out as the guest again.
 */
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("a new session asks again", () => {
  it.each([
    ["sign in", "src/modules/auth/hooks/useAuth.ts", "export function useLogin("],
    ["sign up", "src/modules/marketplace/hooks/useMarketplace.ts", "export function useRegisterCustomer("],
  ])("%s invalidates the cache after the session is stored", (_what, rel, anchor) => {
    const src = read(rel);
    const at = src.indexOf(anchor);
    expect(at).toBeGreaterThan(-1);
    const hook = src.slice(at, src.indexOf("\n}\n", at));

    const stored = hook.indexOf("await setAuth(");
    const stale = hook.indexOf("await queryClient.invalidateQueries()");
    expect(stored).toBeGreaterThan(-1);
    expect(stale).toBeGreaterThan(stored);
  });
});
