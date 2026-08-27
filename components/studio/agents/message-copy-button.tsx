"use client";

import { useState, useCallback } from "react";
import { Check, Copy } from "@/lib/icon-theme/lucide-react";

/** Message copy button with copied-feedback state (t3code's MessageCopyButton style). */
export function MessageCopyButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        className ??
        "text-muted-foreground hover:text-foreground transition-colors"
      }
      aria-label="Copy message"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}
