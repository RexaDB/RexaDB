import { cn } from "@/lib/utils";
import type { ComponentType } from "react";

interface HeaderIconButtonProps {
  icon: ComponentType<{ className?: string }>;
  onClick?: () => void;
  title: string;
  active?: boolean;
  sleekLayout?: boolean;
  native?: boolean;
}

export function HeaderIconButton({
  icon: Icon,
  onClick,
  title,
  active,
  sleekLayout,
  native,
}: HeaderIconButtonProps) {
  return (
    <button
      onClick={onClick ?? (() => {})}
      className={cn(
        "flex items-center justify-center transition-colors no-drag",
        native
          ? "h-8 w-8 hover:bg-studio-border/50"
          : "border border-studio-border rounded-lg bg-background/15 hover:bg-background/25",
        native ? "rounded" : sleekLayout ? "h-8 w-8" : "h-9 w-9",
      )}
      title={title}
    >
      <Icon
        className={cn(
          sleekLayout ? "w-3.5 h-3.5" : "w-4 h-4",
          active ? "text-primary" : "text-muted-foreground/60",
        )}
      />
    </button>
  );
}
