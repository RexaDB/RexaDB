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
        <Button variant="outline" className="bg-background border-border h-9 text-xs flex items-center gap-2 px-3 hover:bg-muted/40 transition-all text-muted-foreground">
          <span className="font-normal opacity-50">database</span>
          <span className="text-foreground font-mediumtracking-tight">{selectedDatabase}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 bg-popover border-border text-foreground shadow-2xl">
        {databases.length === 0 ? (
          <DropdownMenuItem className="text-xs text-muted-foreground">No databases found</DropdownMenuItem>
        ) : databases.map((db) => (
          <DropdownMenuItem key={db} onClick={() => onDatabaseChange(db)} className={`text-xs ${selectedDatabase === db ? "bg-blue-500/10 text-blue-500" : ""}`}>
            {db}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
