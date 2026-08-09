"use client";

import { useMemo, useState } from "react";
import type { RedisKeyInfo } from "@/types/redis";
import { RedisKeysHeader } from "./redis-keys-header";
import { RedisKeysToolbar } from "./redis-keys-toolbar";
import { RedisKeysTable } from "./redis-keys-table";

interface RedisKeysListProps {
  keys: RedisKeyInfo[];
  selectedDatabase: string;
  databases: string[];
  onDatabaseChange: (db: string) => void;
  onKeyClick: (key: string) => void;
  onCreateKeyTab: () => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function RedisKeysList({
  keys,
  selectedDatabase,
  databases,
  onDatabaseChange,
  onKeyClick,
  onCreateKeyTab,
  onRefresh,
  isLoading = false,
}: RedisKeysListProps) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((item) => item.key.toLowerCase().includes(q));
  }, [keys, search]);

  return (
    <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden min-h-0">
      <RedisKeysHeader selectedDatabase={selectedDatabase} />
      <RedisKeysToolbar
        search={search}
        onSearchChange={setSearch}
        selectedDatabase={selectedDatabase}
        databases={databases}
        onDatabaseChange={onDatabaseChange}
        onCreateKey={onCreateKeyTab}
        onRefresh={onRefresh}
        isLoading={isLoading}
      />
      <RedisKeysTable keys={filtered} search={search} onKeyClick={onKeyClick} />
    </div>
  );
}
