"use client";

import { RefreshCw, Plus } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";

interface RedisKeysActionsProps {
  onCreateKey: () => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function RedisKeysActions({ onCreateKey, onRefresh, isLoading = false }: RedisKeysActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button onClick={onCreateKey} variant="outline" className="h-9 text-xs flex items-center gap-2 px-3 border-border bg-background hover:bg-muted/40">
        <Plus className="w-3.5 h-3.5" />
        <span>New Key</span>
      </Button>
      <Button onClick={onRefresh} className="bg-blue-600 hover:bg-blue-700 h-9 text-xs flex items-center gap-2 px-4 transition-all" disabled={isLoading}>
        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        <span>Refresh</span>
      </Button>
    </div>
  );
}
