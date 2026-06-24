/**
 * Bundled default Kinetica logo, rendered INLINE (not via <img src>) so it themes
 * through CSS variables: the "K" mark uses --accent (brand violet, reads on both
 * the near-black dark surface and the warm off-white light surface) and the
 * wordmark uses --text (the active theme's text color), so it stays legible in
 * dark AND light mode.
 *
 * Why inline is OK here: the "logo is always <img>" rule (82-CONTEXT / Phase 81)
 * guards against UNTRUSTED uploaded SVGs executing script. This is first-party,
 * trusted markup — no XSS surface. Custom uploaded logos still render via <img>
 * in Sidebar.tsx, preserving that boundary.
 */
type Props = {
  className?: string;
  /** Accessible name; also the alt-equivalent for the role="img" element. */
  title?: string;
};

export default function DefaultLogo({ className, title = "Kinetica BI" }: Props): JSX.Element {
  return (
    <svg
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 32"
      width="120"
      height="32"
      fill="none"
    >
      {/* Kinetica "K" mark — brand violet via the theme token */}
      <rect x="0" y="4" width="4" height="24" rx="1.5" fill="var(--accent)" />
      <polygon points="4,16 16,4 21,4 9,16" fill="var(--accent)" />
      <polygon points="4,16 16,28 21,28 9,16" fill="var(--accent)" />
      {/* wordmark — follows the active theme's text color */}
      <text
        x="28"
        y="22"
        fontFamily="var(--font-body, system-ui, sans-serif)"
        fontSize="14"
        fontWeight="700"
        letterSpacing="0.5"
        fill="var(--text)"
      >
        Kinetica
      </text>
    </svg>
  );
}
