import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { ago } from "../src/common/ui/RefreshPill";

/**
 * A POLLING SCREEN HAS TO SAY HOW OLD IT IS.
 *
 * There is no websocket server in this product, so "live" means a poll. A
 * silent poll is worse than no poll: somebody staring at "Preparing" cannot
 * tell whether the shop has not moved or the phone has not asked, and their
 * next move — wait, close the app, ring the shop — depends entirely on which.
 *
 * Two rules, and the second is the one that will actually be broken one day,
 * when a third screen starts polling and nobody remembers this file exists.
 */

describe("how long ago, in words", () => {
  const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();

  it("says just now inside the first ten seconds", () => {
    expect(ago(at(0))).toBe("Just now");
    expect(ago(at(9))).toBe("Just now");
  });

  it("counts seconds, then minutes, then hours", () => {
    expect(ago(at(10))).toBe("10s ago");
    expect(ago(at(59))).toBe("59s ago");
    expect(ago(at(60))).toBe("1m ago");
    expect(ago(at(59 * 60))).toBe("59m ago");
    expect(ago(at(60 * 60))).toBe("1h ago");
    expect(ago(at(23 * 3600))).toBe("23h ago");
    expect(ago(at(25 * 3600))).toBe("A while ago");
  });

  it("does not tell somebody their data arrives in the future", () => {
    // The timestamp is the SERVER's and the clock reading it is the PHONE's.
    // A phone four seconds behind would otherwise render "in 4 seconds" — or,
    // with a naive Math.abs, "4s ago" for data that has not been fetched yet.
    // Fresh is fresh.
    expect(ago(at(-4))).toBe("Just now");
    expect(ago(at(-3600))).toBe("Just now");
  });

  it("has an answer for never, and for nonsense", () => {
    expect(ago(null)).toBe("Not checked yet");
    expect(ago(undefined)).toBe("Not checked yet");
    // A server that changes its date format must not render "NaNs ago".
    expect(ago("not a date")).toBe("Not checked yet");
  });
});

describe("nothing polls in silence", () => {
  /** Comments stripped — prose about polling is not polling. */
  const codeOnly = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const files = sourceFiles(path.join(PROJECT_ROOT, "src"));

  it("found the source tree", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  /**
   * Every hook that sets a `refetchInterval`, and every screen that reads it.
   *
   * A hook file is where the interval lives; the SCREEN is where the person
   * looking at stale data is standing. So the rule is checked one hop out:
   * the screens that consume a polling hook must render the control.
   */
  it("gives every polling screen a way to see the age and ask again", () => {
    // PER HOOK, not per file.
    //
    // The first version of this asked which FILES contained `refetchInterval`
    // and then treated every hook they exported as polling — so `useMyOrders`,
    // which does not poll and never did, was flagged because it happens to sit
    // in the same file as `useMyOrder`, which does. A guard that reports a
    // screen doing nothing wrong is a guard people learn to silence.
    const hookNames = new Set<string>();

    for (const file of files) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));
      if (!src.includes("refetchInterval:")) continue;

      // Each `export function useX` starts a block that ends where the next
      // top-level `export` begins. Crude, and exact enough: this file has one
      // hook per export and no nesting of them.
      const blocks = src.split(/(?=^export )/m);
      for (const block of blocks) {
        const name = /^export function (use\w+)/.exec(block)?.[1];
        if (name != null && block.includes("refetchInterval:")) hookNames.add(name);
      }
    }

    // Two today: the customer's order, and the rider's board. If this drops to
    // zero the rule below would pass by checking nothing.
    expect([...hookNames].sort()).toEqual(["useMyOrder", "useRiderBoard"]);

    const offenders: string[] = [];

    for (const file of files) {
      const rel = path.relative(PROJECT_ROOT, file);
      if (!/screens\//.test(rel)) continue;

      const src = codeOnly(fs.readFileSync(file, "utf8"));

      // Does this screen call a hook that polls, and bind its result?
      const polls = [...hookNames].some((h) => new RegExp(`\\b${h}\\s*\\(`).test(src));
      if (!polls) continue;

      // A list screen that merely renders rows from a polling hook is not the
      // subject — the subject is a screen somebody SITS ON while it changes,
      // which is the one that also offers a pull-to-refresh.
      if (!/RefreshControl/.test(src)) continue;

      if (!/RefreshPill/.test(src)) offenders.push(`  ${rel}`);
    }

    expect(offenders.join("\n")).toBe("");
  });

  it("never binds the pull spinner to a background refetch", () => {
    // Duplicated deliberately from `pullToRefresh.test.ts`, aimed at the
    // reason rather than the pattern: on a screen that polls every ten
    // seconds, `refreshing={q.isRefetching}` puts the indicator on screen six
    // times a minute, over whatever the person had scrolled to.
    const offenders = files
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /refreshing=\{[\w.]*\.isRefetching\}/.test(line))
          .map(([n]) => `  ${path.relative(PROJECT_ROOT, f)}:${n}`),
      );

    expect(offenders.join("\n")).toBe("");
  });
});
