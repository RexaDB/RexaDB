/** PayKit mark. Uses currentColor so it adapts to light/dark themes. */
export function PaykitLogo({ className }: { className?: string }) {
  return (
    <svg
      width="114"
      height="123"
      viewBox="0 0 114 123"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="PayKit"
      role="img"
    >
      <path d="M0 76H67V123H0V76Z" fill="currentColor" />
      <path d="M67 47H0V0H114V76H67V47Z" fill="currentColor" />
    </svg>
  );
}
