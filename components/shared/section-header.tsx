"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between transition-all duration-300",
        className,
      )}
    >
      <div>
        <h2 className="font-bold tracking-tight text-sm">{title}</h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
