import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  // Every test starts with an empty session. A leaked auth store is how a
  // gating test passes for the wrong reason.
  localStorage.clear();
});

// jsdom implements neither, and both are touched by chart and layout code the
// moment a page renders.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Charts pull a canvas the instant they mount; nothing under test reads pixels.
vi.mock("react-apexcharts", () => ({ default: () => null }));
