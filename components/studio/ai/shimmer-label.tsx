"use client";

export const SHIMMER_KEYFRAMES =
  `@keyframes shimmer-text { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }`;

export const PIXEL_KEYFRAMES =
  `@keyframes pixel-on { 0%,100% { opacity: 0.15; } 50% { opacity: 1; } }`;

export function ShimmerLabel({
  label,
  tone = "primary",
  className = "bg-clip-text text-[13px] font-medium text-transparent",
}: {
  label: string;
  tone?: "primary" | "foreground";
  className?: string;
}) {
  const center = tone === "primary" ? "var(--primary)" : "var(--foreground)";
  return (
    <span
      className={className}
      style={{
        backgroundImage: `linear-gradient(90deg, var(--muted-foreground) 35%, ${center} 50%, var(--muted-foreground) 65%)`,
        backgroundSize: "200% 100%",
        animation: "shimmer-text 1.4s linear infinite",
      }}
    >
      {label}
    </span>
  );
}

export function ElapsedTime({
  value,
  className = "font-mono text-[12px] text-muted-foreground tabular-nums",
}: {
  value: string;
  className?: string;
}) {
  return <span className={className}>{value}</span>;
}

export function LoaderKeyframes({ includePixel = true }: { includePixel?: boolean }) {
  return (
    <style>{`${includePixel ? `${PIXEL_KEYFRAMES} ` : ""}${SHIMMER_KEYFRAMES} @media (prefers-reduced-motion: reduce) { span[style*="pixel-on"] { animation: none !important; opacity: 0.15 !important; } span[style*="shimmer-text"] { animation: none !important; } }`}</style>
  );
}
