"use client";

import { AiEmptyState } from "@/components/studio/ai/ai-empty-state";
import { AiMessageContent } from "@/components/studio/ai/ai-message-content";
import type { ThemeBlockData } from "@/components/studio/ai/ai-theme-block";
import type { StoredAiChatMessage, AgentWorkflowPlan } from "@/lib/ai/types";

interface AiMessageListProps {
  messages: StoredAiChatMessage[];
  dashboardApplyLabel?: string;
  onSendToSql: (query: string) => void;
  onRunSql?: (query: string) => void;
  onApplyDashboard: (dashboard: any) => void;
  onApplyAppTheme?: (block: ThemeBlockData) => void;
  onApplyEditorTheme?: (block: ThemeBlockData) => void;
  onApplyWorkflow: (plan: AgentWorkflowPlan) => void;
  workflowApplyBusy?: boolean;
  userName: string;
  emptyIdeas: string[];
  onSelectIdea: (idea: string) => void;
  onApprovalSubmit?: (answers: { question: string; type: string; selected: string[]; custom?: string }[]) => void;
}

export function AiMessageList({
  messages,
  dashboardApplyLabel,
  onSendToSql,
  onRunSql,
  onApplyDashboard,
  onApplyAppTheme,
  onApplyEditorTheme,
  onApplyWorkflow,
  workflowApplyBusy,
  userName,
  emptyIdeas,
  onSelectIdea,
  onApprovalSubmit,
}: AiMessageListProps) {
  return (
    <div className="px-4 pt-4">
      <div className="mx-auto max-w-2xl space-y-5">
        {messages.length === 0 ? (
          <AiEmptyState ideas={emptyIdeas} onSelectIdea={onSelectIdea} />
        ) : null}
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-white/8 px-4 py-2.5 text-sm leading-6 text-foreground whitespace-pre-wrap">
                {message.content}
              </div>
            </div>
          ) : message.content ? (
            <div key={message.id} className="text-sm leading-7 text-foreground">
              <AiMessageContent
                content={message.content}
                dashboardApplyLabel={dashboardApplyLabel}
                onApplyAppTheme={onApplyAppTheme}
                onApplyEditorTheme={onApplyEditorTheme}
                onApplyDashboard={onApplyDashboard}
                onApplyWorkflow={onApplyWorkflow}
                onRunSql={onRunSql}
                onSendToSql={onSendToSql}
                workflowApplyBusy={workflowApplyBusy}
                onApprovalSubmit={onApprovalSubmit}
              />
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
