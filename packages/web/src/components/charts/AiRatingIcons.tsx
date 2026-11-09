// 149: first-party thumb icons. Static, trusted, coloured by currentColor (no user content, no hex).
type IconProps = { filled?: boolean; size?: number };

const PATH = "M7 10v11H3V10h4zm0 11h10.3a2 2 0 0 0 2-1.6l1.4-7A2 2 0 0 0 18.7 10H14V5a2 2 0 0 0-2-2l-5 7";

function Thumb({ filled = false, size = 16, flip }: IconProps & { flip?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {flip ? (
        <g transform="rotate(180 12 12)">
          <path d={PATH} />
        </g>
      ) : (
        <path d={PATH} />
      )}
    </svg>
  );
}

export function ThumbUpIcon(props: IconProps) {
  return <Thumb {...props} />;
}
export function ThumbDownIcon(props: IconProps) {
  return <Thumb {...props} flip />;
}
