"use client";

import { X } from "@/lib/icon-theme/lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const METRIC_TINT_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
];

interface TintColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
  label: string;
  triggerSize?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: { trigger: "h-3 w-3", icon: "h-2 w-2" },
  md: { trigger: "h-4 w-4", icon: "h-2.5 w-2.5" },
  lg: { trigger: "h-6 w-6", icon: "h-3 w-3" },
};

export function TintColorPicker({
  value,
  onChange,
  label,
  triggerSize = "md",
}: TintColorPickerProps) {
  const sizes = sizeMap[triggerSize];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Select ${label} color`}
          className={`${sizes.trigger} rounded-lg border border-studio-border/80 flex items-center justify-center`}
          style={
            value
              ? {
                  backgroundColor: value,
                  borderColor: value,
                }
              : { backgroundColor: "#6b7280" }
          }
        >
          {!value ? <X className={`${sizes.icon} text-white`} /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-[2000] pointer-events-auto w-auto p-1.5 border-studio-border/80 bg-studio-bg"
      >
        <div className="grid grid-cols-8 gap-1">
          <button
            type="button"
            aria-label={`No ${label} color`}
            onClick={() => onChange(null)}
            className={cn(
              "h-4 w-4 rounded-lg border flex items-center justify-center bg-gray-600",
              value === null ? "border-foreground/80" : "border-transparent",
            )}
          >
            <X className="h-2.5 w-2.5 text-white" />
          </button>
          {METRIC_TINT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Set ${label} tint ${color}`}
              onClick={() => onChange(color)}
              className={cn(
                "h-4 w-4 rounded-lg border",
                value === color ? "border-foreground/80" : "border-transparent",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
