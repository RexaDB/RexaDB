"use client";

import { ChevronDown, ChevronRight, Plus, Trash2 } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StoredAiChat } from "@/lib/ai/types";
import { StudioTooltip } from "@/components/studio/studio-tooltip";

interface AiChatHistoryMenuProps {
  chats: StoredAiChat[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
  onDelete: (chatId: string) => void;
}

export function AiChatHistoryMenu({
  chats,
  activeChatId,
  onSelect,
  onNewChat,
  onDelete,
}: AiChatHistoryMenuProps) {
  const activeTitle = chats.find((chat) => chat.id === activeChatId)?.title || "New Chat";

  return (
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-7 gap-1.5 px-2 text-left text-xs font-medium" variant="ghost">
          <span className="max-w-[180px] truncate">{activeTitle}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-[80] w-64 border-border bg-popover">
        <DropdownMenuItem className="gap-2 text-xs" onClick={onNewChat}>
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </DropdownMenuItem>
        {chats.length > 0 ? <DropdownMenuSeparator /> : null}
        {chats.map((chat) => (
          <DropdownMenuItem
            key={chat.id}
            className="flex items-center justify-between gap-3 text-xs"
            onClick={() => onSelect(chat.id)}
          >
            <span className="truncate">{chat.title}</span>
            <div className="flex items-center gap-1">
              {chat.id === activeChatId ? <ChevronRight className="h-3.5 w-3.5 opacity-70" /> : null}
              <StudioTooltip label="Delete Chat" side="right">
                <Button
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(chat.id);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </StudioTooltip>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
