"use client";

import type { AdvisorResult } from "@/lib/db/advisor/types";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const levelBadge = (severity: string): "destructive" | "secondary" | "outline" => {
  switch (severity) {
    case "critical": return "destructive";
    case "warning": return "secondary";
    default: return "outline";
  }
};

const typeBadge = (category: string): "destructive" | "secondary" | "outline" => {
  switch (category) {
    case "security": return "destructive";
    default: return "secondary";
  }
};

export function AdvisorCheckCard({
  result,
  onClick,
}: {
  result: AdvisorResult;
  onClick: () => void;
}) {
  if (result.passed) return null;

  const { check, detail } = result;

  return (
    <div
      onClick={onClick}
      className={cn(
        "py-4 border-b last:border-b-0 group cursor-pointer",
        "transition-colors hover:bg-muted/30 -mx-6 px-6",
      )}
    >
      <div className="flex-1">
        <div className="flex justify-start items-start gap-4">
          <h4 className="font-semibold text-sm">{check.title}</h4>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant={levelBadge(check.severity)} className="shrink-0">
              {check.severity.toUpperCase()}
            </Badge>
            <Badge variant={typeBadge(check.category)} className="shrink-0">
              {check.category.charAt(0).toUpperCase() + check.category.slice(1)}
            </Badge>
          </div>
        </div>
        <div className="text-sm text-muted-foreground mt-2 prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
