"use client";

import { Fragment, ReactNode } from "react";

function renderBold(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-bold-${index}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }

    return <Fragment key={`${keyPrefix}-text-${index}`}>{part}</Fragment>;
  });
}

export function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`code-${index}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }

    return <Fragment key={`fragment-${index}`}>{renderBold(part, `fragment-${index}`)}</Fragment>;
  });
}
