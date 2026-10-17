"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface RedisKeysDatabaseSelectProps {
  selectedDatabase: string;
  databases: string[];
  onDatabaseChange: (db: string) => void;
}

export function RedisKeysDatabaseSelect({ selectedDatabase, databases, onDatabaseChange }: RedisKeysDatabaseSelectProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="bg-background border-border text-xs flex items-center gap-2 hover:bg-muted/40 transition-all text-muted-foreground">
          <span className="font-normal opacity-50">database</span>
          <span className="text-foreground font-medium tracking-tight">{selectedDatabase}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 bg-popover border-border text-foreground shadow-2xl">
        {databases.length === 0 ? (
          <DropdownMenuItem className="text-xs text-muted-foreground">No databases found</DropdownMenuItem>
        ) : databases.map((db) => (
          <DropdownMenuItem key={db} onClick={() => onDatabaseChange(db)} className={`text-xs ${selectedDatabase === db ? "bg-primary/10 text-primary" : ""}`}>
            {db}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
