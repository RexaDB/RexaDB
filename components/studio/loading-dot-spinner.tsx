"use client";

import { cn } from "@/lib/utils";

const DOTS = Array.from({ length: 8 }, (_, index) => index);

export function LoadingDotSpinner({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const spinnerSize = {
    sm: "2.2rem",
    md: "2.8rem",
    lg: "3.4rem",
  };

  return (
    <div
      className={cn(
        "relative flex items-center justify-start text-primary [--spinner-speed:.9s]",
        className,
      )}
      style={
        {
          "--uib-size": spinnerSize[size],
          width: "var(--uib-size)",
          height: "var(--uib-size)",
        } as React.CSSProperties
      }
    >
      {DOTS.map((dot) => (
        <div
          key={dot}
          className="absolute left-0 top-0 flex h-full w-full items-center justify-start"
          style={{
            transform: `rotate(${dot * 45}deg)`,
          }}
        >
          <span
            className="block h-[20%] w-[20%] rounded-lg bg-current opacity-50 animate-[loading-dot-pulse_calc(var(--spinner-speed)*1.111)_ease-in-out_infinite]"
            style={{
              animationDelay: `calc(var(--spinner-speed) * ${-0.125 * dot})`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
