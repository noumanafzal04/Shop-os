import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useKeptStore } from "../common/kept/keptStore";

afterEach(() => {
  cleanup();
  // Every test starts with an empty session. A leaked auth store is how a
  // gating test passes for the wrong reason.
  localStorage.clear();
  // …and with nothing kept on the device. The shell's answers outlive a
  // reload on purpose (common/kept), which in a test file means outliving the
  // test: the next one would open with the last one's settings and never ask
  // for the ones it mocked.
  useKeptStore.setState({ record: null });
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
