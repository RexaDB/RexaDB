"use client";

import { FileText } from "@/lib/icon-theme/lucide-react";

export function AiEmptyState({
  ideas,
  onSelectIdea,
}: {
  ideas: string[];
  onSelectIdea: (idea: string) => void;
}) {
  return (
    <div className="space-y-6 px-2 py-4">
      <h3 className="text-sm font-medium tracking-tight text-foreground">How can I assist you?</h3>

      <div className="space-y-3">
        <div className="text-xs font-mediumtracking-[0.22em] text-muted-foreground">
          Ideas
        </div>
        {ideas.map((idea) => (
          <button
            key={idea}
            className="flex w-full items-center gap-3 text-left text-sm text-foreground transition-colors hover:text-foreground/80"
            onClick={() => onSelectIdea(idea)}
            type="button"
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            {idea}
          </button>
        ))}
      </div>
    </div>
  );
}
