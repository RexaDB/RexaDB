"use client";

import { ChevronDown, ChevronUp, Search, X } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SqlQueryFindProps {
  matchCount: number;
  searchValue: string;
  selectedIndex: number;
  onChange: (value: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

export function SqlQueryFind({
  matchCount,
  searchValue,
  selectedIndex,
  onChange,
  onClose,
  onNext,
  onPrevious,
}: SqlQueryFindProps) {
  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-lg">
      <Search className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        autoFocus
        className="h-7 w-40 border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
        onPaste={(event) => event.stopPropagation()}
        placeholder="Find"
        value={searchValue}
      />
      <span className="min-w-12 px-1 text-xs text-muted-foreground">
        {matchCount ? `${selectedIndex + 1}/${matchCount}` : "0/0"}
      </span>
      <Button
        className="h-7 w-7"
        onClick={onPrevious}
        size="icon"
        variant="ghost"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button className="h-7 w-7" onClick={onNext} size="icon" variant="ghost">
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button className="h-7 w-7" onClick={onClose} size="icon" variant="ghost">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
