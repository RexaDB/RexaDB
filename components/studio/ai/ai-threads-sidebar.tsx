"use client";

import { useCallback, useEffect, useState } from "react";
import {
  History,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  deleteStudioChat,
  listStudioChats,
} from "@/lib/api/studio-chat-storage";
import type { StoredAiChat } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { formatRelativeTime as formatRelativeTimeShared } from "@/lib/format-relative";

function formatRelativeTime(timestamp: number): string {
  return formatRelativeTimeShared(timestamp, { suffix: " ago", nowLabel: "just now" });
}

/**
 * AI threads sidebar for the Modern UI. Renders like the AI chat panel (an
 * in-flow card to the right of the content) and lists the AI chats saved for
 * the current connection. Selecting a thread opens it in the AI chat panel;
 * the delete button removes it, "New chat" opens a fresh conversation.
 */
export function AiThreadsSidebar({
  connectionId,
  activeChatId,
  onSelectChat,
  onNewChat,
  onClose,
}: {
  connectionId: number;
  activeChatId?: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}) {
  const [chats, setChats] = useState<StoredAiChat[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listStudioChats(connectionId);
    if (result.success && result.data) {
      setChats(
        [...result.data].sort((a, b) => b.updatedAt - a.updatedAt),
      );
    }
    setLoading(false);
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, [load]);

  const handleDelete = async (chatId: string) => {
    await deleteStudioChat(chatId, connectionId);
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
  };

  const headerButtonClass =
    "h-7 w-7 rounded-md text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--shell-content-bg)] text-foreground">
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-1.5 px-1.5">
          <History className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">Threads</span>
          {chats.length > 0 && (
            <span className="rounded-full bg-white/8 px-1.5 text-[10px] text-muted-foreground">
              {chats.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Refresh threads"
                className={headerButtonClass}
                onClick={() => void load()}
                size="icon"
                variant="ghost"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="New chat"
                className={headerButtonClass}
                onClick={onNewChat}
                size="icon"
                variant="ghost"
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New chat</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Close threads"
                className={headerButtonClass}
                onClick={onClose}
                size="icon"
                variant="ghost"
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Close</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {loading && chats.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <RefreshCw className="size-4 animate-spin text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground/60">Loading threads…</p>
          </div>
        ) : chats.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <History className="size-5 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground/60">
              No threads yet. Ask the AI something to get started.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {chats.map((chat) => {
              const active = chat.id === activeChatId;
              return (
                <li key={chat.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelectChat(chat.id)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
                      active
                        ? "border-border bg-white/8 text-foreground"
                        : "hover:bg-white/5",
                    )}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-xs font-medium">
                        {chat.title || "New chat"}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        {formatRelativeTime(chat.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${chat.title || "chat"}`}
                    onClick={() => void handleDelete(chat.id)}
                    className="absolute right-1.5 top-1/2 hidden size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/8 hover:text-destructive group-hover:flex"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
