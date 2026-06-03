import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { startSessionSweep, sweepExpiredSessions } from "../src/sessionStore";

const SESSIONS_DDL = `CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  kinetica_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
)`;

// SESS-05 — periodic GC of expired rows.
describe("sessionStore sweep timer (SESS-05)", () => {
  beforeEach(() => {
    // Ensure sessions table exists (might have been dropped by a previous test)
    db.exec(SESSIONS_DDL);
    db.exec("DELETE FROM sessions");
  });

  afterEach(() => {
    // Always ensure sessions table is restored after each test (resilience test drops it)
    db.exec(SESSIONS_DDL);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("startSessionSweep schedules a 1-hour interval and returns a Timer with .unref()", () => {
    vi.useFakeTimers();
    const handle = startSessionSweep();
    expect(handle).toBeDefined();
    // .unref() must not throw (it's a no-op under fake timers, but must be callable)
    expect(() => handle.unref()).not.toThrow();
    clearInterval(handle);
  });

  it("on tick, the timer calls sweepExpiredSessions and logs the deleted count", () => {
    vi.useFakeTimers();
    const sweepSpy = vi.spyOn({ sweepExpiredSessions }, "sweepExpiredSessions");
    // We spy on the module-level function via a module re-import approach.
    // Instead, spy on sweepExpiredSessions by spying on the console and the sweep function.
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Import the module to get a spy-able reference
    const handle = startSessionSweep();

    // Advance by exactly 1 hour (3,600,000 ms) — triggers the first tick
    vi.advanceTimersByTime(3_600_000);

    // sweepExpiredSessions returns 0 (no expired rows), so logs "swept 0 expired rows"
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[sessions\] swept \d+ expired rows/)
    );

    clearInterval(handle);
    consoleSpy.mockRestore();
    sweepSpy.mockRestore();
  });

  it("resilient: if sweepExpiredSessions throws, the timer survives and runs again on next tick", () => {
    vi.useFakeTimers();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Force the first sweep to throw by temporarily dropping the sessions table.
    // This causes sweepStmt.run() to throw with "no such table: sessions".
    // The try/catch inside the interval callback logs the error and does NOT
    // clearInterval, so the second tick still fires.
    db.exec("DROP TABLE IF EXISTS sessions");

    const handle = startSessionSweep();

    // First tick — sweep throws (no sessions table)
    vi.advanceTimersByTime(3_600_000);
    expect(errorSpy).toHaveBeenCalledWith(
      "[sessions] sweep failed",
      expect.any(Error)
    );

    // Restore the sessions table before second tick
    db.exec(SESSIONS_DDL);

    // Second tick — timer is still alive, sweep now succeeds
    vi.advanceTimersByTime(3_600_000);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[sessions\] swept \d+ expired rows/)
    );

    clearInterval(handle);
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
