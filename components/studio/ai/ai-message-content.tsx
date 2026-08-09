"use client";

import { AiDashboardBlock } from "@/components/studio/ai/ai-dashboard-block";
import {
  AiThemeBlock,
  type ThemeBlockData,
} from "@/components/studio/ai/ai-theme-block";
import { AiWorkflowBlock } from "@/components/studio/ai/ai-workflow-block";
import { renderInlineMarkdown } from "@/components/studio/ai/ai-inline-markdown";
import { AiSqlBlock } from "@/components/studio/ai/ai-sql-block";
import { parseDashboardBlock, parseThemeBlock, parseWorkflowBlock } from "@/lib/ai/chat-blocks";
import { parseMarkdownBlocks } from "@/lib/ai/markdown-blocks";
import type { AgentWorkflowPlan } from "@/lib/ai/types";

export function AiMessageContent({
  content,
  dashboardApplyLabel,
  onSendToSql,
  onRunSql,
  onApplyDashboard,
  onApplyAppTheme,
  onApplyEditorTheme,
  onApplyWorkflow,
  workflowApplyBusy,
}: {
  content: string;
  dashboardApplyLabel?: string;
  onSendToSql: (query: string) => void;
  onRunSql?: (query: string) => void;
  onApplyDashboard: (dashboard: any) => void;
  onApplyAppTheme?: (block: ThemeBlockData) => void;
  onApplyEditorTheme?: (block: ThemeBlockData) => void;
  onApplyWorkflow: (plan: AgentWorkflowPlan) => void;
  workflowApplyBusy?: boolean;
}) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="space-y-3 text-sm leading-7 text-foreground">
      {blocks.map((block, index) => {
        if (block.type === "paragraph") {
          return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
        }

        if (block.type === "list") {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>
                  {renderInlineMarkdown(item)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "code") {
          if (block.language.toLowerCase() === "sql") {
            return (
              <AiSqlBlock
                key={index}
                onOpenInEditor={onSendToSql}
                onRun={onRunSql}
                query={block.code}
              />
            );
          }

          if (block.language.toLowerCase() === "dashboard") {
            const dashboard = parseDashboardBlock(
              `\`\`\`dashboard\n${block.code}\n\`\`\``,
            );
            if (dashboard) {
              return (
                <AiDashboardBlock
                  applyLabel={dashboardApplyLabel}
                  key={index}
                  dashboard={dashboard}
                  onApplyDashboard={onApplyDashboard}
                />
              );
            }
          }

          if (block.language.toLowerCase() === "theme") {
            const themeBlock = parseThemeBlock(
              `\`\`\`theme\n${block.code}\n\`\`\``,
            );
            if (themeBlock) {
              const handleApply = () => {
                if (themeBlock.type === "app" && onApplyAppTheme) {
                  onApplyAppTheme(themeBlock);
                } else if (themeBlock.type === "editor" && onApplyEditorTheme) {
                  onApplyEditorTheme(themeBlock);
                }
              };
              const needsButton =
                (themeBlock.type === "app" && onApplyAppTheme) ||
                (themeBlock.type === "editor" && onApplyEditorTheme);
              if (needsButton) {
                return (
                  <AiThemeBlock
                    key={index}
                    themeBlock={themeBlock}
                    onApply={handleApply}
                  />
                );
              }
            }
          }

          if (block.language.toLowerCase() === "workflow") {
            const workflowPlan = parseWorkflowBlock(
              `\`\`\`workflow\n${block.code}\n\`\`\``,
            );
            if (workflowPlan) {
              return (
                <AiWorkflowBlock
                  busy={workflowApplyBusy}
                  key={index}
                  onApplyWorkflow={onApplyWorkflow}
                  plan={workflowPlan}
                />
              );
            }
          }

          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-6"
            >
              <code>{block.code}</code>
            </pre>
          );
        }

        return (
          <div
            key={index}
            className="overflow-x-auto rounded-lg border border-border"
          >
            <table className="min-w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  {block.headers.map((header, headerIndex) => (
                    <th
                      key={`${header}-${headerIndex}`}
                      className="border-b border-border px-3 py-2 font-medium"
                    >
                      {renderInlineMarkdown(header)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="border-b border-border last:border-b-0"
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${cell}-${cellIndex}`}
                        className="px-3 py-2 align-top"
                      >
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
