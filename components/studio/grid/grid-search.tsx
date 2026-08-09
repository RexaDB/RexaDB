"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Search,
  X,
  Type,
  Code2,
  Hash,
} from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Match {
  rowIndex: number;
  columnName: string;
  matchStart: number;
  matchEnd: number;
}

interface GridSearchProps {
  isOpen: boolean;
  onClose: () => void;
  rows: any[];
  fields: string[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onNavigateToMatch: (rowIndex: number, columnName: string) => void;
  currentMatchIndex: number;
  onMatchIndexChange: (index: number) => void;
  matchCount: number;
  onReplaceCurrent?: (rowIndex: number, columnName: string, newValue: string) => void;
  onReplaceAll?: (searchValue: string, replaceValue: string) => number;
}

export function GridSearch({
  isOpen,
  onClose,
  rows,
  fields,
  searchQuery,
  onSearchQueryChange,
  onNavigateToMatch,
  currentMatchIndex,
  onMatchIndexChange,
  matchCount,
  onReplaceCurrent,
  onReplaceAll,
}: GridSearchProps) {
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [searchDirection, setSearchDirection] = useState<"down" | "up">("down");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && !showReplace && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen, showReplace]);

  useEffect(() => {
    if (!isOpen) {
      setCaseSensitive(false);
      setUseRegex(false);
      setWholeWord(false);
      setSearchDirection("down");
      setReplaceQuery("");
      setShowReplace(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (showReplace && replaceInputRef.current) {
      replaceInputRef.current.focus();
    }
  }, [showReplace]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          setSearchDirection("up");
          if (matchCount > 0) {
            const newIndex = currentMatchIndex > 0 ? currentMatchIndex - 1 : matchCount - 1;
            onMatchIndexChange(newIndex);
            const match = getMatchAtIndex(newIndex);
            if (match) {
              onNavigateToMatch(match.rowIndex, match.columnName);
            }
          }
        } else {
          setSearchDirection("down");
          if (matchCount > 0) {
            const newIndex = currentMatchIndex < matchCount - 1 ? currentMatchIndex + 1 : 0;
            onMatchIndexChange(newIndex);
            const match = getMatchAtIndex(newIndex);
            if (match) {
              onNavigateToMatch(match.rowIndex, match.columnName);
            }
          }
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
    [currentMatchIndex, matchCount, onClose, onMatchIndexChange, onNavigateToMatch]
  );

  const getMatchAtIndex = useCallback(
    (index: number): { rowIndex: number; columnName: string } | null => {
      const allMatches = getAllMatches();
      return allMatches[index] || null;
    },
    [rows, fields, searchQuery, caseSensitive, useRegex, wholeWord]
  );

  const getAllMatches = useCallback((): Match[] => {
    if (!searchQuery || rows.length === 0) return [];

    const matches: Match[] = [];
    let regex: RegExp | null = null;

    try {
      if (useRegex) {
        regex = new RegExp(searchQuery, caseSensitive ? "g" : "gi");
      } else {
        const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let pattern = escaped;
        if (wholeWord) {
          pattern = `\\b${pattern}\\b`;
        }
        regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
      }
    } catch {
      return [];
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      for (const columnName of fields) {
        const value = row[columnName];
        if (value === null || value === undefined) continue;
        const strValue = String(value);
        let match: RegExpExecArray | null;
        regex.lastIndex = 0;
        while ((match = regex.exec(strValue)) !== null) {
          matches.push({
            rowIndex,
            columnName,
            matchStart: match.index,
            matchEnd: match.index + match[0].length,
          });
          if (match.index === 0) break;
        }
      }
    }

    return matches;
  }, [rows, fields, searchQuery, caseSensitive, useRegex, wholeWord]);

  const allMatches = useMemo(
    () => getAllMatches(),
    [getAllMatches]
  );

  if (!isOpen) return null;

  return (
    <div className="absolute top-0 right-2 z-50 flex flex-col rounded-b-md border-x border-b border-studio-border bg-studio-bg/98 shadow-xl">
      <div className="flex items-center gap-0.5 px-1 py-1">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                onClick={() => setShowReplace(!showReplace)}
                className="h-6 w-6 p-0 rounded-none shrink-0"
                size="icon"
                variant="ghost"
              >
                <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showReplace && "rotate-90")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{showReplace ? "Hide Replace" : "Show Replace"}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex items-center">
          <Input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search"
            className="h-6 w-44 border border-studio-border bg-transparent px-1.5 py-0 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-[#858596]"
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="flex items-center gap-0.5 px-1">
          <span className="min-w-[3.5rem] text-center text-xs text-[#858596] tabular-nums">
            {matchCount > 0
              ? `${currentMatchIndex + 1} of ${matchCount}`
              : matchCount === 0 && searchQuery
              ? "No results"
              : "Search"}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() => {
                    if (matchCount > 0) {
                      const newIndex = currentMatchIndex > 0 ? currentMatchIndex - 1 : matchCount - 1;
                      onMatchIndexChange(newIndex);
                      const match = allMatches[newIndex];
                      if (match) {
                        onNavigateToMatch(match.rowIndex, match.columnName);
                      }
                    }
                  }}
                  className={cn(
                    "h-6 w-6 p-0",
                    searchDirection === "up" && "bg-accent"
                  )}
                  size="icon"
                  variant="ghost"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Previous (Shift+Enter)</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() => {
                    if (matchCount > 0) {
                      const newIndex = currentMatchIndex < matchCount - 1 ? currentMatchIndex + 1 : 0;
                      onMatchIndexChange(newIndex);
                      const match = allMatches[newIndex];
                      if (match) {
                        onNavigateToMatch(match.rowIndex, match.columnName);
                      }
                    }
                  }}
                  className={cn(
                    "h-6 w-6 p-0",
                    searchDirection === "down" && "bg-accent"
                  )}
                  size="icon"
                  variant="ghost"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Next (Enter)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center gap-0.5 px-1.5">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() => setCaseSensitive(!caseSensitive)}
                  className={cn("h-6 w-6 p-0", caseSensitive && "bg-accent")}
                  size="icon"
                  variant="ghost"
                >
                  <Type className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Match Case (Alt+C)</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() => setUseRegex(!useRegex)}
                  className={cn("h-6 w-6 p-0", useRegex && "bg-accent")}
                  size="icon"
                  variant="ghost"
                >
                  <Code2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Use Regular Expression (Alt+R)</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() => setWholeWord(!wholeWord)}
                  className={cn("h-6 w-6 p-0", wholeWord && "bg-accent")}
                  size="icon"
                  variant="ghost"
                >
                  <Hash className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Match Whole Word (Alt+W)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center">
          <Button
            type="button"
            onClick={onClose}
            className="h-6 w-6 p-0 rounded-none"
            size="icon"
            variant="ghost"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {showReplace && (
        <div className="flex items-center gap-0.5 px-1 pb-1">
          <div className="w-[1.55rem] shrink-0" />
          
          <div className="flex items-center">
            <Input
              ref={replaceInputRef}
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder="Replace"
              className="h-6 w-44 border border-studio-border bg-transparent pl-1.5 pr-0 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-[#858596]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && matchCount > 0) {
                  const match = getMatchAtIndex(currentMatchIndex);
                  if (match) {
                    onNavigateToMatch(match.rowIndex, match.columnName);
                  }
                }
              }}
            />
          </div>

          <div className="flex items-center gap-0.5 px-1">
            <Button
              type="button"
              onClick={() => {
                if (!onReplaceCurrent || matchCount === 0 || replaceQuery === "") return;
                const match = getMatchAtIndex(currentMatchIndex);
                if (match) {
                  onReplaceCurrent(match.rowIndex, match.columnName, replaceQuery);
                }
              }}
              className="h-6 px-2 py-0 text-xs"
              size="sm"
              variant="ghost"
              disabled={matchCount === 0 || replaceQuery === ""}
            >
              Replace
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!onReplaceAll || searchQuery === "" || replaceQuery === "") return;
                onReplaceAll(searchQuery, replaceQuery);
              }}
              className="h-6 px-2 py-0 text-xs"
              size="sm"
              variant="ghost"
              disabled={matchCount === 0 || replaceQuery === ""}
            >
              All
            </Button>
          </div>

          <div className="w-[1.55rem] shrink-0" />
        </div>
      )}
    </div>
  );
}