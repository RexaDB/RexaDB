"use client";

import type { Permission } from "@/lib/studio-backend/types";
import { PermissionRow } from "./permission-row";

export function PermissionCheckboxList({
  allPermissions,
  selectedPerms,
  togglePerm,
}: {
  allPermissions: Permission[];
  selectedPerms: number[];
  togglePerm: (id: number) => void;
}) {
  return allPermissions.map((perm) => (
    <PermissionRow
      key={perm.id}
      perm={perm}
      selected={selectedPerms.includes(perm.id)}
      onToggle={togglePerm}
    />
  ));
}
