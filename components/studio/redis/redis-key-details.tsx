"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { runQuery } from "@/lib/api/actions-client";
import {
  formatTtlHuman,
  getRedisKeyCommand,
  updateRedisConnectionStringDatabase,
} from "@/lib/db/redis-utils";
import type { RedisKeyInfo } from "@/types/redis";
import { Clock, RefreshCcw, Save, Trash2, X, ChevronDown } from "@/lib/icon-theme/lucide-react";
import { toast } from "sonner";
import { TTL_UNITS, TtlUnitSelect } from "./redis-ttl-unit-select";

interface RedisKeyDetailsProps {
  keyInfo: RedisKeyInfo | null;
  onOpenCommand: (key: string, type: string) => void;
  connectionString: string | null;
  selectedDatabase: string | null;
  executionMode: "direct" | "review";
  setPendingActions: (updater: (prev: any[]) => any[]) => void;
  setIsReviewSheetOpen: (open: boolean) => void;
}

function quoteRedisArg(raw: string) {
  const input = String(raw ?? "");
  if (!input.length) return '""';
  if (/[\s"]/g.test(input)) {
    return `"${input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return input;
}

function formatRedisRows(rows: any[]) {
  if (!rows || rows.length === 0) return "";
  if (rows.length === 1 && rows[0] && typeof rows[0] === "object") {
    const keys = Object.keys(rows[0]);
    if (keys.length === 1) return String(rows[0][keys[0]] ?? "");
  }
  return JSON.stringify(rows, null, 2);
}

function ensureRedisConnection(
  hasKeyInfo: boolean,
  resolvedConnection: string | null,
): string | null {
  if (!hasKeyInfo) return null;
  if (!resolvedConnection) {
    toast.error("No Redis connection available.");
    return null;
  }
  return resolvedConnection;
}

function handleReviewMode(
  executionMode: "direct" | "review",
  command: string,
  queueRedisAction: (command: string) => void,
): boolean {
  if (executionMode === "review") {
    queueRedisAction(command);
    return true;
  }
  return false;
}

export function RedisKeyDetails({
  keyInfo,
  onOpenCommand,
  connectionString,
  selectedDatabase,
  executionMode,
  setPendingActions,
  setIsReviewSheetOpen,
}: RedisKeyDetailsProps) {
  // NOTE: Large component retained to avoid broad refactor while fixing hook order.
  const hasKeyInfo = Boolean(keyInfo);
  const safeKeyInfo: RedisKeyInfo = keyInfo ?? {
    key: "",
    type: "string",
    ttlSeconds: null,
    size: null,
  };

  const [value, setValue] = useState("");
  const [isLoadingValue, setIsLoadingValue] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [ttlSeconds, setTtlSeconds] = useState<number | null>(
    safeKeyInfo.ttlSeconds,
  );
  const [ttlDraft, setTtlDraft] = useState("");
  const [ttlUnit, setTtlUnit] = useState(TTL_UNITS[0].value);
  const [isTtlSaving, setIsTtlSaving] = useState(false);

  const resolvedConnection = useMemo(() => {
    if (!connectionString) return null;
    if (!selectedDatabase) return connectionString;
    return updateRedisConnectionStringDatabase(
      connectionString,
      selectedDatabase,
    );
  }, [connectionString, selectedDatabase]);

  const ttlLabel = ttlSeconds === null ? "Forever" : formatTtlHuman(ttlSeconds);
  const keyType = safeKeyInfo.type.toUpperCase();

  const queueRedisAction = useCallback(
    (command: string) => {
      setPendingActions((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(2, 9),
          type: "redis_command" as const,
          description: `Redis: ${command}`,
          sql: command,
          metadata: {
            redisDb: selectedDatabase,
            key: safeKeyInfo.key,
            kind: "key_update",
          },
        },
      ]);
      setIsReviewSheetOpen(true);
    },
    [
      setPendingActions,
      setIsReviewSheetOpen,
      selectedDatabase,
      safeKeyInfo.key,
    ],
  );

  const loadValue = useCallback(async () => {
    if (!hasKeyInfo) return;
    if (!resolvedConnection) {
      toast.error("No Redis connection available.");
      return;
    }
    setIsLoadingValue(true);
    try {
      const command = getRedisKeyCommand(safeKeyInfo.key, safeKeyInfo.type);
      const res = await runQuery(resolvedConnection, command);
      if (!res.success) {
        toast.error(res.error || "Failed to load key value.");
        return;
      }
      const rows = res.data?.rows ?? [];
      setValue(formatRedisRows(rows));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load key value.",
      );
    } finally {
      setIsLoadingValue(false);
    }
  }, [hasKeyInfo, resolvedConnection, safeKeyInfo.key, safeKeyInfo.type]);

  const handleSave = useCallback(async () => {
    const conn = ensureRedisConnection(hasKeyInfo, resolvedConnection);
    if (!conn) return;
    try {
      if (safeKeyInfo.type !== "string") {
        toast.info("Non-string values are edited in the command editor.");
        onOpenCommand(safeKeyInfo.key, safeKeyInfo.type);
        return;
      }
      const command = `SET ${quoteRedisArg(safeKeyInfo.key)} ${quoteRedisArg(value)}`;
      if (handleReviewMode(executionMode, command, queueRedisAction)) return;
      setIsSaving(true);
      const res = await runQuery(conn, command);
      if (!res.success) {
        toast.error(res.error || "Failed to save value.");
        return;
      }
      toast.success("Value saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save value.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    executionMode,
    hasKeyInfo,
    onOpenCommand,
    queueRedisAction,
    resolvedConnection,
    safeKeyInfo.key,
    safeKeyInfo.type,
    value,
  ]);

  // fallow-ignore-next-line code-duplication
  const handleDelete = useCallback(async () => {
    const conn = ensureRedisConnection(hasKeyInfo, resolvedConnection);
    if (!conn) return;
    try {
      const command = `DEL ${quoteRedisArg(safeKeyInfo.key)}`;
      if (handleReviewMode(executionMode, command, queueRedisAction)) return;
      setIsDeleting(true);
      const res = await runQuery(conn, command);
      if (!res.success) {
        toast.error(res.error || "Failed to delete key.");
        return;
      }
      setValue("");
      toast.success("Key deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete key.",
      );
    } finally {
      setIsDeleting(false);
    }
  }, [
    executionMode,
    hasKeyInfo,
    queueRedisAction,
    resolvedConnection,
    safeKeyInfo.key,
  ]);

  useEffect(() => {
    if (!hasKeyInfo) return;
    setValue("");
    loadValue();
  }, [hasKeyInfo, loadValue, safeKeyInfo.key]);

  useEffect(() => {
    if (!hasKeyInfo) return;
    setTtlSeconds(safeKeyInfo.ttlSeconds);
  }, [hasKeyInfo, safeKeyInfo.key, safeKeyInfo.ttlSeconds]);

  const handleApplyTtl = useCallback(async () => {
    const conn = ensureRedisConnection(hasKeyInfo, resolvedConnection);
    if (!conn) return;
    const raw = ttlDraft.trim();
    const numeric = Number(raw);
    if (!raw || !Number.isFinite(numeric) || numeric <= 0) {
      toast.error("Enter a valid TTL value.");
      return;
    }
    const unit =
      TTL_UNITS.find((entry) => entry.value === ttlUnit) || TTL_UNITS[0];
    const seconds = Math.max(1, Math.floor(numeric * unit.multiplier));
    try {
      const command = `EXPIRE ${quoteRedisArg(safeKeyInfo.key)} ${seconds}`;
      if (handleReviewMode(executionMode, command, queueRedisAction)) return;
      setIsTtlSaving(true);
      const res = await runQuery(conn, command);
      if (!res.success) {
        toast.error(res.error || "Failed to apply TTL.");
        return;
      }
      setTtlSeconds(seconds);
      toast.success("TTL applied.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to apply TTL.",
      );
    } finally {
      setIsTtlSaving(false);
    }
  }, [
    executionMode,
    hasKeyInfo,
    queueRedisAction,
    resolvedConnection,
    safeKeyInfo.key,
    ttlDraft,
    ttlUnit,
  ]);

  // fallow-ignore-next-line code-duplication
  const handleRemoveTtl = useCallback(async () => {
    const conn = ensureRedisConnection(hasKeyInfo, resolvedConnection);
    if (!conn) return;
    try {
      const command = `PERSIST ${quoteRedisArg(safeKeyInfo.key)}`;
      if (handleReviewMode(executionMode, command, queueRedisAction)) return;
      setIsTtlSaving(true);
      const res = await runQuery(conn, command);
      if (!res.success) {
        toast.error(res.error || "Failed to remove TTL.");
        return;
      }
      setTtlSeconds(null);
      toast.success("TTL removed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove TTL.",
      );
    } finally {
      setIsTtlSaving(false);
    }
  }, [
    executionMode,
    hasKeyInfo,
    queueRedisAction,
    resolvedConnection,
    safeKeyInfo.key,
  ]);

  if (!hasKeyInfo) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground bg-studio-bg">
        Select a key to inspect its metadata.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-studio-bg text-foreground min-h-0">
      <div className="flex items-center justify-between border-b border-studio-border bg-background px-8 py-2.5">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={isSaving || isLoadingValue}
            className="h-8 gap-2 bg-blue-600 px-3 text-xs text-white hover:bg-blue-700"
          >
            <Save className="h-3.5 w-3.5" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
          <Button
            onClick={loadValue}
            disabled={isLoadingValue}
            variant="outline"
            size="icon"
            className="h-8 w-8 border-border bg-background text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCcw
              className={`h-4 w-4 ${isLoadingValue ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            onClick={handleDelete}
            disabled={isDeleting}
            variant="outline"
            size="icon"
            className="h-8 w-8 border-border bg-background text-muted-foreground hover:text-foreground"
            aria-label="Delete"
          >
            <Trash2 className={`h-4 w-4 ${isDeleting ? "opacity-70" : ""}`} />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Popover
            onOpenChange={(open) => {
              if (!open) return;
              if (ttlSeconds !== null) {
                setTtlDraft(String(ttlSeconds));
                setTtlUnit("seconds");
              } else {
                setTtlDraft("");
                setTtlUnit("seconds");
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                className="flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground"
                type="button"
              >
                <Clock className="h-3.5 w-3.5" />
                {ttlLabel}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-72 border-studio-border bg-studio-bg p-4 text-foreground"
            >
              <div className="text-xs font-semiboldtext-muted-foreground">
                TTL
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Input
                  value={ttlDraft}
                  onChange={(event) => setTtlDraft(event.target.value)}
                  placeholder="Value"
                  inputMode="numeric"
                  className="h-8 bg-muted/20 border-studio-border text-sm rounded-lg"
                />
                <TtlUnitSelect
                  value={ttlUnit}
                  onValueChange={setTtlUnit}
                  selectItemClassName="rounded-lg text-sm focus:bg-muted/40 data-[state=checked]:bg-muted/40 data-[state=checked]:text-foreground [&>span]:hidden pl-3 pr-3"
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground"
                  onClick={handleRemoveTtl}
                  disabled={isTtlSaving}
                >
                  Remove TTL
                </button>
                <Button
                  onClick={handleApplyTtl}
                  disabled={isTtlSaving}
                  className="h-8 bg-blue-600 px-4 text-xs text-white hover:bg-blue-700"
                >
                  {isTtlSaving ? "Applying..." : "Apply"}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <span className="inline-flex h-7 items-center rounded-lg border border-blue-500 bg-blue-500/30 px-2.5 text-xs font-semiboldtext-blue-400">
            {keyType}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-studio-border bg-background/60 px-8 py-2 text-sm text-muted-foreground">
        <span>Key:</span>
        <span className="font-medium text-foreground">{safeKeyInfo.key}</span>
      </div>

      <div className="flex-1 overflow-hidden">
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={isLoadingValue ? "Loading value..." : "Value"}
          className="h-full w-full resize-none rounded-none border-0 bg-transparent px-8 py-4 font-mono text-xs text-foreground shadow-none focus-visible:border-0 focus-visible:ring-0"
        />
      </div>
    </div>
  );
}
