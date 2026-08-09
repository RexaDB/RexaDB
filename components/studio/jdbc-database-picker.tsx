"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { JdbcDriverTemplate } from "@/lib/db/jdbc-templates";
import { Search } from "@/lib/icon-theme/lucide-react";
import { JdbcLogo, useJdbcFilter } from "./jdbc-shared";

export function JdbcDatabasePicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (driver: JdbcDriverTemplate) => void;
}) {
  const [search, setSearch] = useState("");
  const { filtered, grouped } = useJdbcFilter(search);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Choose a database</DialogTitle>
        </DialogHeader>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search databases..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <ScrollArea className="h-[55vh]">
          <div className="space-y-5">
            {grouped.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No databases match "{search}"
              </p>
            )}
            {grouped.map((group) => (
              <div key={group.id}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                  {group.label}
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.items.map((db) => (
                    <button
                      key={db.name}
                      type="button"
                      className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-accent/50 transition-colors text-left"
                      onClick={() => {
                        onSelect(db);
                        onOpenChange(false);
                      }}
                    >
                      <JdbcLogo name={db.name} className="shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{db.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate font-mono">
                          {db.driverClass}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
