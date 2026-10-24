import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Next rounds #36: the offline copy swept every png and svg in the build — 287
 * files, 6.5 MB of template artwork no shop screen shows — and a till on live
 * took 80–90 s to be safe offline. Read from the real config, run against the
 * real files the build copies from `public/`.
 */
const config = fs.readFileSync("vite.config.ts", "utf8");
const globs = JSON.parse(/globPatterns:\s*(\[[^\]]*\])/.exec(config)?.[1] ?? "[]") as string[];
const held = (file: string) => globs.some((g) => path.matchesGlob(file, g));

const files = (dir: string, under = ""): string[] =>
  fs.readdirSync(path.join(dir, under), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(dir, path.join(under, e.name)) : [path.join(under, e.name).split(path.sep).join("/")],
  );
const publicFiles = files("public");

describe("the offline copy holds the shell and nothing else", () => {
  it("is reading the real config and the real files", () => {
    expect(globs.length).toBeGreaterThan(1);
    expect(publicFiles.length).toBeGreaterThan(50);
  });

  it("holds what a till needs to paint with no line", () => {
    for (const f of ["favicon.png", "icon-192.png", "sw-heal.js", "assets/index-abc.js", "assets/index-abc.css", "index.html"]) {
      expect(held(f), f).toBe(true);
    }
    // The app's own art: its logo, its error pages, its sign-in backdrop.
    for (const f of publicFiles.filter((p) => /^images\/(logo|error|shape)\//.test(p) && /\.(png|svg)$/.test(p))) {
      expect(held(f), f).toBe(true);
    }
  });

  it("leaves out the template's demo artwork and the landing page's pictures", () => {
    const left = publicFiles.filter((f) => /^images\/(carousel|cards|grid-image|task|user|brand|country|video-thumb|chat|product|icons)\//.test(f) || f.startsWith("landing/"));
    expect(left.length).toBeGreaterThan(40);
    expect(left.filter((f) => held(f))).toEqual([]);
  });
});
