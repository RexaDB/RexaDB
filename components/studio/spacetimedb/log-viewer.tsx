"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  streamSpacetimeDbLogs,
  type SpacetimeDbLogLine,
  type SpacetimeDbLogLevel,
} from "@/lib/db/spacetimedb-client";
import {
  ScrollText,
  RotateCw,
  Pause,
  Play,
  X,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  SearchX,
  Terminal,
} from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";

const LOG_LEVELS: SpacetimeDbLogLevel[] = ["trace", "debug", "info", "warn", "error", "panic"];

const LEVEL_COLORS: Record<SpacetimeDbLogLevel, string> = {
  trace: "text-muted-foreground",
  debug: "text-blue-500",
  info: "text-emerald-500",
  warn: "text-amber-500",
  error: "text-red-500",
  panic: "text-red-600 font-bold",
};

const LEVEL_ICONS: Record<SpacetimeDbLogLevel, typeof Bug> = {
  trace: Bug,
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
  panic: AlertCircle,
};

export function SpacetimeDbLogViewer({
  connectionString,
  onClose,
}: {
  connectionString: string;
  onClose?: () => void;
}) {
  const [lines, setLines] = useState<SpacetimeDbLogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [levels, setLevels] = useState<SpacetimeDbLogLevel[]>(["info", "warn", "error", "panic"]);
  const [fileFilter, setFileFilter] = useState("");
  const [textFilter, setTextFilter] = useState("");
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoScrollRef = useRef(true);

  const startStream = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();

    streamSpacetimeDbLogs(
      connectionString,
      (line) => {
        setLines((prev) => [line, ...prev].slice(0, 10000));
        setConnected(true);
      },
      () => { setConnected(false); },
      { numLines: 1000 },
    ).then((controller) => {
      abortRef.current = controller;
      setConnected(true);
    });
  }, [connectionString]);

  useEffect(() => {
    startStream();
    return () => { abortRef.current?.abort(); };
  }, [startStream]);

  useEffect(() => {
    if (!paused && autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [lines, paused]);

  const filteredLines = useMemo(() => {
    return lines.filter((line) => {
      if (levels.length > 0 && !levels.includes(line.level)) return false;
      if (fileFilter && !line.filename?.toLowerCase().includes(fileFilter.toLowerCase())) return false;
      if (textFilter && !line.message?.toLowerCase().includes(textFilter.toLowerCase())) return false;
      return true;
    });
  }, [lines, levels, fileFilter, textFilter]);

  const toggleLevel = (level: SpacetimeDbLogLevel) => {
    setLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <ScrollText className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Logs</span>
        <div className="flex items-center gap-1 ml-2">
          {LOG_LEVELS.map((level) => {
            const Icon = LEVEL_ICONS[level];
            return (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                  levels.includes(level)
                    ? LEVEL_COLORS[level] + " bg-muted"
                    : "text-muted-foreground/40"
                )}
              >
                <Icon className="w-3 h-3" />
                {level}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <Input
          value={fileFilter}
          onChange={(e) => setFileFilter(e.target.value)}
          placeholder="Filter file..."
          className="w-28 h-7 text-xs"
        />
        <Input
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          placeholder="Search text..."
          className="w-36 h-7 text-xs"
        />
        <Badge
          variant={connected ? "default" : "secondary"}
          className={cn("text-[10px] px-1.5 py-0", connected ? "bg-emerald-500/20 text-emerald-500" : "")}
        >
          {connected ? "live" : "disconnected"}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startStream}>
          <RotateCw className="w-3.5 h-3.5" />
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1" ref={scrollRef}>
        {filteredLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-2 text-sm text-muted-foreground">
            <SearchX className="w-8 h-8" />
            <span>{connected ? "No matching log lines" : "Connecting to log stream..."}</span>
          </div>
        ) : (
          <div className="font-mono text-xs leading-relaxed">
            {filteredLines.map((line, i) => {
              const LevelIcon = LEVEL_ICONS[line.level];
              return (
                <div
                  key={`${line.time}-${i}`}
                  className={cn(
                    "flex items-start gap-2 px-4 py-0.5 hover:bg-muted/40 border-b border-border/10",
                    LEVEL_COLORS[line.level]
                  )}
                >
                  <span className="shrink-0 text-[10px] text-muted-foreground w-20 truncate">
                    {line.time ? new Date(line.time).toLocaleTimeString() : ""}
                  </span>
                  <LevelIcon className="w-3 h-3 mt-0.5 shrink-0" />
                  <span className="shrink-0 text-[10px] text-muted-foreground w-16 truncate">
                    {line.level}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground w-24 truncate">
                    {line.filename ? `${line.filename}:${line.line_number || ""}` : ""}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-words">
                    {line.message}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="flex items-center justify-between px-4 py-1 border-t border-border text-[10px] text-muted-foreground shrink-0">
        <span>{filteredLines.length} lines</span>
        <span className={paused ? "text-amber-500 font-medium" : ""}>
          {paused ? "PAUSED" : connected ? "streaming" : "disconnected"}
        </span>
      </div>
    </div>
  );
}
