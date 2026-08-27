"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { Undo2 } from "@/lib/icon-theme/lucide-react";
import type {
  AgentChatMessage,
  AgentWorkLogEntry,
} from "@/lib/agents/provider-types";
import type { RexaAgentAppMode } from "@/lib/agents/app-modes";
import { formatDuration } from "@/lib/agents/work-log";
import { AgentMarkdown } from "./agent-markdown";
import { TurnFoldTimelineRow } from "./thinking-row";
import LoadingState from "./loading-state";
import { WorkGroupSection, LiveWorkEntryRow } from "./work-entries";
import { MessageCopyButton } from "./message-copy-button";
import { formatChatTimestamp } from "./chat-timestamp";

export function AgentsChatMessages({
  messages,
  isStreaming,
  workLog = [],
  streamingStartedAt = null,
  onRevert,
  appMode,
}: {
  messages: AgentChatMessage[];
  isStreaming: boolean;
  workLog?: AgentWorkLogEntry[];
  streamingStartedAt?: number | null;
  onRevert?: (messageId: string) => void;
  appMode?: RexaAgentAppMode;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expandedTurnIds, setExpandedTurnIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, workLog]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/60">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  const lastAssistantId = messages
    .filter((m) => m.role === "assistant")
    .at(-1)?.id;

  const toggleTurnFold = (turnId: string) => {
    setExpandedTurnIds((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  };

  return (
    <div className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 [overflow-anchor:none] sm:px-5">
      <div className="h-3 sm:h-4" aria-hidden />
      {messages.map((message) => {
        if (message.role === "user") {
          return (
            <div key={message.id} className="mx-auto w-full min-w-0 max-w-3xl">
              <UserMessageRow
                message={message}
                canRevert={!!onRevert}
                onRevert={onRevert}
              />
            </div>
          );
        }

        // Assistant message = terminal row of its turn.
        const turnId = message.id;
        const turnEntries = workLog.filter((e) => e.turnId === turnId);
        const streamingThisTurn =
          isStreaming && message.id === lastAssistantId;
        const liveEntries = turnEntries.filter(
          (e) => e.status === "inProgress",
        );

        return (
          <div key={message.id} className="mx-auto w-full min-w-0 max-w-3xl overflow-x-clip">
            {/* Turn header: live "Working for Xs" while streaming, settled
                turns fold their activity behind "Worked for Xs ▸". */}
            {streamingThisTurn ? (
              <div className="pb-1.5">
                <WorkingTimelineBlock
                  startedAt={streamingStartedAt}
                  showThinking={turnEntries.length === 0 && !message.content}
                  liveEntries={liveEntries}
                />
              </div>
            ) : turnEntries.length > 0 ? (
              <div className="pb-1.5">
                <TurnFoldTimelineRow
                  label={turnFoldLabel(message)}
                  expanded={expandedTurnIds.has(turnId)}
                  onToggle={() => toggleTurnFold(turnId)}
                />
                {expandedTurnIds.has(turnId) ? (
                  <WorkGroupSection
                    entries={turnEntries}
                    onCollapse={() => toggleTurnFold(turnId)}
                  />
                ) : null}
              </div>
            ) : null}

            {/* Terminal assistant message stays visible below the fold. */}
            <AssistantMessageRow
              message={message}
              isStreaming={streamingThisTurn}
              canApplySchemaPlan={appMode?.allowSqlWrite === true}
            />
          </div>
        );
      })}
      <div ref={bottomRef} />
      <div className="h-3 sm:h-4" aria-hidden />
    </div>
  );
}

/** t3code deriveTurnFolds label logic. */
function turnFoldLabel(message: AgentChatMessage): string {
  const durationMs = message.metadata?.durationMs as number | undefined;
  const interrupted = message.metadata?.interrupted === true;
  const duration =
    typeof durationMs === "number" ? formatDuration(durationMs) : null;
  return interrupted
    ? duration
      ? `You stopped after ${duration}`
      : "You stopped this response"
    : duration
      ? `Worked for ${duration}`
      : "Worked";
}

/** t3code's WorkingTimelineRow: pixel-grid loader for both Thinking and Working, plus live tool rows. */
function WorkingTimelineBlock({
  startedAt,
  showThinking,
  liveEntries,
}: {
  startedAt: number | null;
  showThinking: boolean;
  liveEntries: AgentWorkLogEntry[];
}) {
  return (
    <div>
      <div className="border-b border-border/60 pb-2 pt-1">
        <LoadingState
          label={liveEntries.length > 0 ? "Working" : "Thinking"}
          variant="Drive"
        />
      </div>
      {liveEntries.length > 0 ? (
        <div className="mt-1 space-y-px">
          {liveEntries.map((entry) => (
            <LiveWorkEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UserMessageRow({
  message,
  canRevert,
  onRevert,
}: {
  message: AgentChatMessage;
  canRevert: boolean;
  onRevert?: (messageId: string) => void;
}) {
  return (
    <div className="group flex flex-col items-end gap-1 pb-4">
      <div className="relative max-w-[80%] rounded-2xl bg-accent p-3 text-accent-foreground">
        <p className="whitespace-pre-wrap leading-relaxed text-sm">
          {message.content}
        </p>
      </div>
      <div className="flex w-full max-w-[80%] items-center justify-end gap-2 pe-1 text-xs tabular-nums opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        {canRevert && onRevert ? (
          <button
            type="button"
            onClick={() => onRevert(message.id)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Revert to this message"
          >
            <Undo2 className="size-3" />
          </button>
        ) : null}
        <MessageCopyButton text={message.content} />
        <p className="text-muted-foreground tabular-nums">
          {formatChatTimestamp(message.timestamp)}
        </p>
      </div>
    </div>
  );
}

function AssistantMessageRow({
  message,
  isStreaming,
  canApplySchemaPlan = false,
}: {
  message: AgentChatMessage;
  isStreaming: boolean;
  canApplySchemaPlan?: boolean;
}) {
  // t3code AssistantTimelineRow: settled empties render "(empty response)".
  const messageText = message.content || (isStreaming ? "" : "(empty response)");

  if (isStreaming && !message.content) {
    // The Working block above provides the activity UI while waiting.
    return null;
  }

  return (
    <div className={cn("group/assistant", isStreaming ? "pb-2" : "pb-4")}>
      <div className="relative min-w-0 px-1 py-0.5">
        <AgentMarkdown
          content={messageText}
          isStreaming={isStreaming}
          canApplySchemaPlan={canApplySchemaPlan}
        />
        {!isStreaming && message.content ? (
          <div className="mt-1.5 flex items-center gap-2 text-xs tabular-nums opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/assistant:opacity-100">
            <MessageCopyButton text={message.content} />
            <p className="text-muted-foreground text-xs tabular-nums">
              {formatChatTimestamp(message.timestamp)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
