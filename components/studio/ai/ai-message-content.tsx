"use client";

import { AiDashboardBlock } from "@/components/studio/ai/ai-dashboard-block";
import { AiThemeBlock } from "@/components/studio/ai/ai-theme-block";
import { AiWorkflowBlock } from "@/components/studio/ai/ai-workflow-block";
import { renderInlineMarkdown } from "@/components/studio/ai/ai-inline-markdown";
import { AiSqlBlock } from "@/components/studio/ai/ai-sql-block";
import { parseTaskBlock } from "@/lib/ai/task-block";
import { parseApprovalBlock } from "@/lib/ai/approval-block";
import TaskRows from "@/components/studio/ai/task-rows";
import ApprovalCard from "@/components/studio/ai/approval-card";
import { parseMarkdownBlocks } from "@/lib/ai/markdown-blocks";
import type { StudioArtifact } from "@/lib/ai/studio-artifacts";

export function AiMessageContent({
  content,
  artifacts = [],
  onSendToSql,
  onRunSql,
  onApprovalSubmit,
}: {
  content: string;
  artifacts?: StudioArtifact[];
  onSendToSql: (query: string) => void;
  onRunSql?: (query: string) => void;
  onApprovalSubmit?: (answers: { question: string; type: string; selected: string[]; custom?: string }[]) => void;
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

          if (["tasks", "task", "task-rows", "task_rows"].includes(block.language.toLowerCase())) {
            const taskBlock = parseTaskBlock(`\`\`\`${block.language}\n${block.code}\n\`\`\``);
            if (taskBlock) {
              return <TaskRows key={index} tasks={taskBlock.tasks} variant={taskBlock.variant} />;
            }
          }

          if (["approval", "ask", "questions", "question"].includes(block.language.toLowerCase())) {
            const approvalBlock = parseApprovalBlock(`\`\`\`${block.language}\n${block.code}\n\`\`\``);
            if (approvalBlock) {
              return (
                <ApprovalCard
                  key={index}
                  questions={approvalBlock.questions}
                  onAnswersSubmit={(answers) => {
                    onApprovalSubmit?.(answers);
                  }}
                  resettable={approvalBlock.resettable}
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
      {artifacts.map((artifact, index) => {
        if (artifact.kind === "dashboard") {
          return <AiDashboardBlock key={`artifact-${index}`} action={artifact.action} dashboard={artifact.dashboard} />;
        }
        if (artifact.kind === "workflow") {
          return <AiWorkflowBlock key={`artifact-${index}`} action={artifact.action} plan={artifact.plan} />;
        }
        return <AiThemeBlock key={`artifact-${index}`} themeBlock={artifact.theme} />;
      })}
    </div>
  );
}
