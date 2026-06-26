// Ambient types for postcss-safe-parser (v7 ships no .d.ts).
// It's the tolerant counterpart to postcss.parse — recovers from syntax errors
// per-rule instead of throwing, returning a standard PostCSS Root.
declare module "postcss-safe-parser" {
  import type { Root } from "postcss";
  const safeParse: (css: string, opts?: { from?: string | undefined }) => Root;
  export default safeParse;
}
