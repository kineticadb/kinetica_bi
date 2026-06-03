// Frontend test setup. Loaded by vitest via setupFiles in vitest.config.ts.
// Loads jest-dom matchers, runs RTL cleanup between tests, clears storage.

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Activate the Zustand store-reset mock at __mocks__/zustand.ts.
// Without this, store mutations bleed across tests.
vi.mock("zustand");

afterEach(() => {
  cleanup();                    // unmount React trees between tests
  sessionStorage.clear();       // Phase 7 uses kbi_returnTo — must be clean per test
  localStorage.clear();         // defensive — no Phase 7 usage but standard hygiene
});
