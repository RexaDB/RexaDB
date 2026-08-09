"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PERMISSION_LEVELS } from "@/lib/studio/types";
import type { PermissionLevel } from "@/lib/studio/types";

export function PermissionLevelSelect({
  value,
  onChange,
  disabled,
  className = "h-7 w-[5.5rem] text-xs",
}: {
  value: PermissionLevel;
  onChange: (value: PermissionLevel) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PermissionLevel)} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERMISSION_LEVELS.map((l) => (
          <SelectItem key={l.value} value={l.value} className="text-xs">
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
