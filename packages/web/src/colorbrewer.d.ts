/**
 * Ambient declaration for the `colorbrewer` ESM build subpath. The package ships
 * types for the bare specifier only; we import `colorbrewer/index.es.js` directly
 * to avoid UMD/ESM interop returning an undefined default (see lib/cbColorThemes.ts).
 *
 * Shape: { schemeGroups: {...}, <SchemeId>: { <count>: string[] } }.
 */
declare module "colorbrewer/index.es.js" {
  const colorbrewer: {
    schemeGroups: {
      sequential: string[];
      singlehue: string[];
      diverging: string[];
      qualitative: string[];
    };
    [scheme: string]: unknown;
  };
  export default colorbrewer;
}
