"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./chat-markdown.css";
import { MarkdownCodeBlock, extractText } from "./markdown-code-block";
import { parseSchemaPlanJson } from "@/lib/ai/chat-blocks";
import { SchemaPlanBlock } from "./schema-plan-block";

/** Markdown renderer with t3code-style component overrides. */
export const AgentMarkdown = memo(function AgentMarkdown({
  content,
  isStreaming,
  canApplySchemaPlan = false,
  onOpenSql,
}: {
  content: string;
  isStreaming?: boolean;
  canApplySchemaPlan?: boolean;
  onOpenSql?: (sql: string) => void;
}) {
  return (
    <div className="agent-markdown chat-markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const match = /language-([\w-]+)/.exec(className || "");
            const language = (match?.[1] || "").toLowerCase();
            const text = extractText(children);
            const isInline = !match && !text.includes("\n");
            if (isInline) {
              return <code>{children}</code>;
            }

            // Prefer schema-plan fences; also upgrade ```json that looks like a plan.
            if (
              language === "schema-plan" ||
              language === "schemaplan" ||
              language === "json" ||
              language === ""
            ) {
              const plan = parseSchemaPlanJson(text);
              if (plan) {
                return (
                  <SchemaPlanBlock
                    plan={plan}
                    canApply={canApplySchemaPlan}
                    onOpenSql={onOpenSql}
                  />
                );
              }
            }

            return (
              <MarkdownCodeBlock language={language} code={text}>
                <pre className="overflow-x-auto p-3 text-xs">
                  <code className={className}>{children}</code>
                </pre>
              </MarkdownCodeBlock>
            );
          },
          p: ({ children }) => (
            <p className="mb-[0.65rem] last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mb-[0.65rem] list-disc pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-[0.65rem] list-decimal pl-5 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="[&+li]:mt-1">{children}</li>
          ),
          h1: ({ children }) => (
            <h1 className="mb-2 mt-5 text-lg font-semibold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-5 text-base font-semibold">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-4 text-sm font-semibold">{children}</h3>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-[0.65rem] border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="chat-markdown-table-container my-[0.65rem] overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted/50 px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1">{children}</td>
          ),
          hr: () => <hr className="my-3 border-border" />,
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-muted-foreground/50 align-text-bottom" />
      )}
    </div>
  );
});
