"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Check, Copy, WrapText } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";

/** Code block with header bar: language label, wrap toggle, copy button (t3code style). */
export function MarkdownCodeBlock({
  language,
  code,
  children,
}: {
  language: string;
  code: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1200);
    });
  }, [code]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div
      className="chat-markdown-codeblock my-[0.65rem] overflow-hidden rounded-lg border border-border/70 bg-muted/40 leading-snug"
      data-language={language}
      data-wrap={wrapped ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-2 py-1.5 pl-3 pr-1.5 select-none">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px]">
          {language || "text"}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-foreground/10"
            aria-pressed={wrapped}
            onClick={() => setWrapped((v) => !v)}
            aria-label={wrapped ? "Disable line wrap" : "Wrap lines"}
          >
            <WrapText className="size-3" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>
        </span>
      </div>
      {children}
    </div>
  );
}

/** Extract plain text from React children for copy functionality. */
export function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText(
      (node as React.ReactElement<{ children?: React.ReactNode }>).props
        .children,
    );
  }
  return "";
}
