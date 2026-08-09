"use client";

import { highlightSql } from "@/lib/ai/sql-highlight";
import { handleTextareaTabKey } from "@/lib/studio/textarea-utils";

interface HighlightedTextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
}

export function HighlightedTextarea({
  value,
  onChange,
  placeholder,
}: HighlightedTextareaProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    handleTextareaTabKey(e, value);
  };

  return (
    <div className="relative min-h-24 rounded-lg border border-input bg-transparent shadow-sm focus-within:ring-1 focus-within:ring-ring">
      <pre className="absolute inset-0 p-3 font-mono text-xs pointer-events-none overflow-auto whitespace-pre-wrap text-foreground/80">
        <code>{value ? highlightSql(value) : null}</code>
      </pre>
      <textarea
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="relative w-full min-h-24 bg-transparent border-none focus:ring-0 p-3 m-0 resize-none text-transparent caret-foreground placeholder:text-muted-foreground outline-none font-mono text-xs"
        spellCheck={false}
      />
    </div>
  );
}
