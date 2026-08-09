"use client";

import { Search } from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { RedisKeysDatabaseSelect } from "./redis-keys-database-select";
import { RedisKeysActions } from "./redis-keys-actions";

interface RedisKeysToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  selectedDatabase: string;
  databases: string[];
  onDatabaseChange: (db: string) => void;
  onRefresh?: () => void;
  onCreateKey: () => void;
  isLoading?: boolean;
}

export function RedisKeysToolbar({
  search,
  onSearchChange,
  selectedDatabase,
  databases,
  onDatabaseChange,
  onRefresh,
  onCreateKey,
  isLoading = false,
}: RedisKeysToolbarProps) {
  return (
    <div className="px-8 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 flex-1">
        <RedisKeysDatabaseSelect
          selectedDatabase={selectedDatabase}
          databases={databases}
          onDatabaseChange={onDatabaseChange}
        />

        <div className="relative flex-1 max-w-sm group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 group-focus-within:text-blue-500 transition-colors" />
          <Input
            placeholder="Search keys"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9 bg-background border-border focus-visible:ring-blue-500/50 text-xs placeholder:text-muted-foreground/30 shadow-sm"
          />
        </div>
      </div>

      <RedisKeysActions onCreateKey={onCreateKey} onRefresh={onRefresh} isLoading={isLoading} />
    </div>
  );
}
