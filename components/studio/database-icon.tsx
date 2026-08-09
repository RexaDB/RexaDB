export function DatabaseIcon({
  size = 24,
  strokeWidth = 2,
  className = "",
  ...props
}: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Top layer */}
      <rect x="4.5" y="3.7" width="15" height="6" rx="1" />

      {/* Middle layer */}
      <rect x="5.6" y="9.7" width="12.9" height="6" rx="0" />

      {/* Bottom layer */}
      <rect x="4.5" y="15.7" width="15" height="6" rx="1" />
    </svg>
  )
}
