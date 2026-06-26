// packages/server/src/lib/brandCssSanitizer.ts
// v1.16 Phase 81 (CSS-V116-02): server-side custom-CSS sanitizer.
// PostCSS AST walk — output is always root.toString() (no regex strip of CSS output).
// A narrow resolveCssUnicodeEscapes() helper normalizes declaration values so the
// AST-based pattern check catches unicode-escape bypasses like `u\72l(` before they
// reach the walker. The CSS document itself is mutated via node.remove() only, never
// via regex replacement. Runs at PUT /api/branding save time, BEFORE storage (defense
// before write). Phase 83 handles @scope wrapping at injection.
import safeParse from "postcss-safe-parser";

// Resolve CSS unicode escapes (e.g. \72 → r, \000075 → u) in a string.
// This is needed because PostCSS preserves raw declaration values without resolving
// unicode escapes — an attacker can write `u\72l(` which PostCSS keeps as-is, but
// a browser resolves to `url(`. We resolve before pattern-matching to close the bypass.
// Spec: https://www.w3.org/TR/css-syntax-3/#consume-escaped-code-point
function resolveCssUnicodeEscapes(s: string): string {
  return s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  );
}

// Declaration values containing any of these are stripped (whole declaration removed):
const BLOCKED_VALUE_PATTERNS = [
  /\burl\s*\(/i,          // url() — exfiltration via background-image etc.
  /\bexpression\s*\(/i,   // IE expression() — JS execution in legacy browsers
  /\bjavascript\s*:/i,    // javascript: pseudo-protocol
  /\bbehavior\s*:/i,      // IE behavior property
  /-moz-binding\s*:/i,    // Gecko -moz-binding: url() XSS
];

// At-rules removed entirely:
const BLOCKED_AT_RULES = new Set([
  "import",    // @import — loads attacker-controlled stylesheet
  "charset",   // @charset — can affect encoding of subsequent rules
  "font-face", // @font-face — can load fonts from attacker URLs
  "namespace", // @namespace — rarely legitimate in custom CSS
]);

/**
 * Sanitize custom CSS using a PostCSS AST walk. Returns the sanitized CSS string.
 *
 * Uses postcss-safe-parser (tolerant) rather than the strict parser: a syntax
 * error in ONE rule no longer discards the whole stylesheet. The parser recovers
 * per-rule, and the walk strips only the offending at-rules / declarations — valid
 * rules are preserved. Empty input → "" (never throws).
 */
export function sanitizeCssPostcss(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  const capped = raw.slice(0, 65_536); // 64 KB cap (DoS guard)
  try {
    const root = safeParse(capped);
    root.walk((node) => {
      if (node.type === "atrule") {
        if (BLOCKED_AT_RULES.has(node.name.toLowerCase())) {
          node.remove();
          return;
        }
      }
      if (node.type === "decl") {
        // Resolve CSS unicode escapes in the value before pattern-matching.
        // PostCSS preserves raw declaration values without resolving escapes, so
        // u\72l( would not match /url\s*\(/i without this step.
        const val = resolveCssUnicodeEscapes(node.value ?? "");
        for (const pattern of BLOCKED_VALUE_PATTERNS) {
          if (pattern.test(val)) {
            node.remove();
            break;
          }
        }
        if (/^-*behavior$/i.test(node.prop)) {
          node.remove();
        }
      }
    });
    // Removing the only declaration from a rule (or all rules from an @media
    // block) leaves an empty shell like `button {}`. Drop those so stripping a
    // single bad part doesn't litter the saved CSS with empty rulesets.
    root.walkRules((rule) => {
      if (rule.nodes.length === 0) rule.remove();
    });
    root.walkAtRules((at) => {
      if (Array.isArray(at.nodes) && at.nodes.length === 0) at.remove();
    });
    return root.toString();
  } catch {
    return "";
  }
}
