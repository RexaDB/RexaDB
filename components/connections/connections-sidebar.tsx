"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Connection } from "@/lib/db/schema";
import { getConnections } from "@/lib/api/actions-client";
import {
  Cloud,
  Search,
  Plus,
  Star,
  ChevronRight,
  ChevronDown,
} from "@/lib/icon-theme/lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProviderLogo } from "@/components/shared/provider-logo";

type ConnectionWithMeta = Connection & {
  queryCount?: number;
};

function getEnvironmentBadge(environment?: string | null) {
  if (!environment) return null;
  const colorMap: Record<string, string> = {
    production: "destructive",
    staging: "warning",
    dev: "default",
    development: "default",
  };
  return (
    <Badge
      variant={(colorMap[environment.toLowerCase()] as any) || "outline"}
      className="text-xs px-1.5 py-0"
    >
      {environment}
    </Badge>
  );
}

export function ConnectionsSidebar({
  selectedConnectionId,
  onSelectConnection,
  embedded = false,
  onAddConnection,
}: {
  selectedConnectionId?: number | null;
  onSelectConnection: (id: number) => void;
  /** When true, fills its parent instead of rendering its own width/border/bg. */
  embedded?: boolean;
  /** Overrides the default "Add Connection" link behaviour when provided. */
  onAddConnection?: () => void;
}) {
  const [connections, setConnections] = useState<ConnectionWithMeta[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getConnections();
      setConnections(result || []);
    } catch (error) {
      console.error("Failed to load connections:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const filtered = connections.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.connectionType?.toLowerCase().includes(q) ||
      c.environment?.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return (
      (a.sortOrder ?? a.createdAt?.getTime() ?? 0) -
      (b.sortOrder ?? b.createdAt?.getTime() ?? 0)
    );
  });

  return (
    <div
      className={cn(
        "flex h-full flex-col",
        embedded
          ? "w-full"
          : "w-64 border-r border-border bg-background",
      )}
    >
      {!embedded && (
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search connections..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {search ? "No connections found" : "No connections yet"}
          </div>
        ) : (
          <div className="p-1">
            {sorted.map((connection) => (
              <button
                key={connection.id}
                onClick={() => onSelectConnection(connection.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                  selectedConnectionId === connection.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-foreground",
                )}
              >
                <div
                  className="flex h-6 w-6 items-center justify-center rounded"
                  style={{
                    backgroundColor: connection.color || "var(--muted)",
                  }}
                >
                  <ProviderLogo type={connection.connectionType} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 truncate">
                    {connection.isFavorite && (
                      <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 shrink-0" />
                    )}
                    <span className="truncate">{connection.name}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {getEnvironmentBadge(connection.environment)}
                    {connection.connectionType && (
                      <span className="text-xs text-muted-foreground capitalize">
                        {connection.connectionType}
                      </span>
                    )}
                  </div>
                </div>
                {selectedConnectionId === connection.id && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {!embedded && (
        <div className="p-3 border-t border-border">
          {onAddConnection ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onAddConnection}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Connection
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="w-full" asChild>
              <a href="/">
                <Plus className="h-4 w-4 mr-2" />
                Add Connection
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
