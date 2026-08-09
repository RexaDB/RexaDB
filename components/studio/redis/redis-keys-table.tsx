"use client";

import type { RedisKeyInfo } from "@/types/redis";
import { formatTtlHuman } from "@/lib/db/redis-utils";

interface RedisKeysTableProps {
  keys: RedisKeyInfo[];
  search: string;
  onKeyClick: (key: string) => void;
}

const formatTtl = (ttl: number | null) => {
  if (ttl === null) return "∞";
  if (ttl < 0) return "—";
  return formatTtlHuman(ttl);
};

export function RedisKeysTable({
  keys,
  search,
  onKeyClick,
}: RedisKeysTableProps) {
  return (
    <div className="px-8 flex-1 overflow-hidden flex flex-col min-h-0">
      <div className="border border-border rounded-lg overflow-hidden flex flex-col flex-1 bg-card/40 shadow-sm min-h-0">
        <div className="grid grid-cols-[1.4fr_120px_120px_120px] bg-muted/30 border-b border-border py-3 px-4">
          <span className="text-xs font-bold text-foreground/80tracking-widest">
            Key
          </span>
          <span className="text-xs font-bold text-foreground/80tracking-widest">
            Type
          </span>
          <span className="text-xs font-bold text-foreground/80tracking-widest">
            TTL
          </span>
          <span className="text-xs font-bold text-foreground/80tracking-widest">
            Size
          </span>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border/60 min-h-0">
          {keys.map((entry) => (
            <div
              key={entry.key}
              onClick={() => onKeyClick(entry.key)}
              className="grid grid-cols-[1.4fr_120px_120px_120px] items-center py-4 px-4 hover:bg-muted/20 transition-colors group cursor-pointer"
            >
              <span className="text-xs font-bold text-foreground tracking-tight truncate">
                {entry.key}
              </span>
              <span className="text-xs text-muted-foreground/70 uppercase">
                {entry.type}
              </span>
              <span className="text-xs text-muted-foreground/70">
                {formatTtl(entry.ttlSeconds)}
              </span>
              <span className="text-xs text-muted-foreground/70">
                {entry.size ?? "—"}
              </span>
            </div>
          ))}

          {keys.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h3 className="text-sm font-medium text-foreground">
                No keys found
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-[220px]">
                {search
                  ? `No keys matching "${search}"`
                  : "This database has no keys yet."}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="h-8" />
    </div>
  );
}
