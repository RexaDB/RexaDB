"use client";

import { Checkbox } from "@/components/ui/checkbox";
import type { Permission } from "@/lib/studio-backend/types";

export function PermissionRow({
  perm,
  selected,
  onToggle,
}: {
  perm: Permission;
  selected: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <label
      key={perm.id}
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 cursor-pointer text-sm"
    >
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggle(perm.id)}
      />
      <div>
        <span>{perm.name}</span>
        <span className="text-xs text-muted-foreground ml-2">
          {perm.code}
        </span>
      </div>
    </label>
  );
}
