"use client";

import { cn } from "@/lib/utils";

interface IconItemProps {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string | null;
  selected: boolean;
  modified: boolean;
  onSelect: (name: string) => void;
}

export function IconItem({
  name,
  icon: IconComp,
  color,
  selected,
  modified,
  onSelect,
}: IconItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(name)}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-sm p-1.5 transition-colors border",
        selected
          ? "border-solid border-foreground/30 bg-studio-border/15"
          : "border-transparent hover:border-dashed hover:border-foreground/20 hover:bg-studio-border/20",
        modified && "ring-1 ring-blue-500/40",
      )}
    >
      <span style={{ color: color ?? undefined }}>
        <IconComp className="h-4 w-4" />
      </span>
      <span className="max-w-[56px] truncate text-[10px] text-muted-foreground">
        {name}
      </span>
      {modified && (
        <span className="h-1 w-1 rounded-full bg-blue-500" />
      )}
    </button>
  );
}
