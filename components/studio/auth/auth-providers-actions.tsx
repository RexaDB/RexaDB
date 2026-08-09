"use client";

import { Button } from "@/components/ui/button";

interface AuthProvidersActionsProps {
  viewMode: "grid" | "table";
  onViewModeChange: (mode: "grid" | "table") => void;
  onAdd: () => void;
}

export function AuthProvidersActions({ viewMode, onViewModeChange, onAdd }: AuthProvidersActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant={viewMode === "grid" ? "secondary" : "ghost"} onClick={() => onViewModeChange("grid")}>Grid</Button>
      <Button size="sm" variant={viewMode === "table" ? "secondary" : "ghost"} onClick={() => onViewModeChange("table")}>Table</Button>
      <Button size="sm" onClick={onAdd}>Add Provider</Button>
    </div>
  );
}
