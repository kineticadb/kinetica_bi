/**
 * State-based router has no useBlocker — App.tsx reads this before leaving
 * the branding page. BrandingSettingsPage writes isDirty + revert via useEffect,
 * App.tsx's onSelect intercept reads them before calling setPage.
 */
export const brandPageGuard = {
  isDirty: false,
  revert: null as null | (() => void),
};
