"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { JdbcDriverTemplate } from "@/lib/db/jdbc-templates";
import { ArrowLeft, Search } from "@/lib/icon-theme/lucide-react";
import { JdbcLogo, useJdbcFilter } from "./jdbc-shared";

export function JdbcDatabasePickerScreen({
  onBack,
  onSelect,
}: {
  onBack: () => void;
  onSelect: (driver: JdbcDriverTemplate) => void;
}) {
  const [search, setSearch] = useState("");
  const { filtered, grouped } = useJdbcFilter(search);

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto scrollbar-hide">
      <div className="flex min-h-full w-full flex-col items-center px-6 py-6">
        <div className="w-full max-w-2xl space-y-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="text-center flex-1 mr-8">
              <h2 className="text-sm font-bold">Choose a Database</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select a JDBC-accessible database engine
              </p>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search databases..."
              className="pl-9 h-11 rounded-lg border-border/60 bg-background font-mono text-sm focus:border-border"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          {grouped.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No databases match &ldquo;{search}&rdquo;
            </p>
          )}

          {grouped.map((group) => (
            <div key={group.id}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {group.label}
              </h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {group.items.map((db) => (
                  <button
                    key={db.name}
                    type="button"
                    className="group flex flex-col items-center justify-center rounded-lg border border-studio-border/60 bg-studio-bg/60 p-3.5 transition-all hover:border-studio-border hover:bg-studio-row-hover/80"
                    onClick={() => onSelect(db)}
                  >
                    <JdbcLogo name={db.name} size={26} className="mb-2 rounded-lg object-contain" />
                    <span className="text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground text-center leading-tight">
                      {db.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
