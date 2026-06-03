/**
 * lib.dynamicViewSql.spec.ts — Phase 32 Plan 01 Task 2 (DV-V16-01).
 *
 * Unit coverage of `substituteViewToken` + `MissingViewTokenError`.
 * Locked decisions live in 32-CONTEXT.md § D1 (token regex /\{\s*view\s*\}/gi,
 * case-insensitive + whitespace-tolerant + global, throw on absence).
 *
 * Mirrors lib.viewNaming.spec.ts shape (vitest, no jest globals, pure module).
 */
import { describe, it, expect } from "vitest";
import {
  substituteViewToken,
  MissingViewTokenError,
} from "../src/lib/dynamicViewSql";

describe("substituteViewToken", () => {
  it("S1: replaces a bare {view} token with the view name", () => {
    expect(substituteViewToken("SELECT * FROM {view}", "foo")).toBe(
      "SELECT * FROM foo"
    );
  });

  it("S2: tolerates whitespace inside the braces — { view }", () => {
    expect(substituteViewToken("SELECT * FROM { view }", "foo")).toBe(
      "SELECT * FROM foo"
    );
  });

  it("S3: case-insensitive — {VIEW}", () => {
    expect(substituteViewToken("SELECT * FROM {VIEW}", "foo")).toBe(
      "SELECT * FROM foo"
    );
  });

  it("S4: case-insensitive — mixed case {View}", () => {
    expect(substituteViewToken("SELECT * FROM {View}", "foo")).toBe(
      "SELECT * FROM foo"
    );
  });

  it("S5: replaces ALL occurrences (global flag) in the same template", () => {
    expect(
      substituteViewToken(
        "SELECT * FROM {view} UNION SELECT * FROM {view}",
        "foo"
      )
    ).toBe("SELECT * FROM foo UNION SELECT * FROM foo");
  });

  it("S6: throws MissingViewTokenError when the template has no {view} token", () => {
    expect(() => substituteViewToken("SELECT * FROM foo", "bar")).toThrow(
      MissingViewTokenError
    );
    try {
      substituteViewToken("SELECT * FROM foo", "bar");
    } catch (err) {
      expect((err as Error).message).toContain("{view}");
    }
  });

  it("S7: a backslash adjacent to the closing brace breaks the regex match — throws", () => {
    // Plan-time deviation note: 32-PLAN said the regex would still match here.
    // It does NOT: /\{\s*view\s*\}/ requires whitespace (or nothing) between
    // `view` and `}`, and a literal backslash is neither. Lock the actual
    // behaviour so future readers do not assume backslash-escape semantics.
    // (The Kinetica SQL parser likewise does not treat backslashes as escapes
    //  at the SQL-statement level — this is a no-op for the operator anyway.)
    expect(() => substituteViewToken("SELECT * FROM \\{view\\}", "foo")).toThrow(
      MissingViewTokenError
    );
  });

  it("S7b: surrounding non-whitespace characters that are NOT immediately adjacent to the braces still match", () => {
    // Surface this regression-style guard so the plan intent (replace happens
    // regardless of surrounding token context, as long as the regex shape is
    // intact) is still asserted.
    expect(substituteViewToken("(SELECT * FROM {view})", "foo")).toBe(
      "(SELECT * FROM foo)"
    );
    expect(substituteViewToken("a{view}b", "foo")).toBe("afoob");
  });

  it("S8: MissingViewTokenError is instanceof Error and instanceof MissingViewTokenError", () => {
    const err = new MissingViewTokenError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MissingViewTokenError);
    expect(err.name).toBe("MissingViewTokenError");
  });

  // Regression guard: /g regex retains state across .test() calls. The helper
  // must reset lastIndex so consecutive calls do not silently no-op.
  it("can be called multiple times in sequence without state leakage", () => {
    expect(substituteViewToken("SELECT * FROM {view}", "foo")).toBe(
      "SELECT * FROM foo"
    );
    expect(substituteViewToken("SELECT * FROM {view}", "bar")).toBe(
      "SELECT * FROM bar"
    );
    expect(substituteViewToken("SELECT * FROM {view}", "baz")).toBe(
      "SELECT * FROM baz"
    );
  });
});
