"use client";

import type { AdvisorResult } from "@/lib/db/advisor/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sparkles,
  ChevronDown,
  ExternalLink,
  X,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EntityIcon } from "./advisor-shared";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function categoryBadgeClass(category: string) {
  switch (category) {
    case "security":
      return "text-orange-400 border-orange-400/40 bg-orange-400/5";
    case "performance":
      return "text-blue-400 border-blue-400/40 bg-blue-400/5";
    default:
      return "text-purple-400 border-purple-400/40 bg-purple-400/5";
  }
}



function getIssueText(checkId: string, entity: string): string {
  switch (checkId) {
    case "tables-without-rls":
      return `Table \`${entity}\` does not have Row Level Security enabled`;
    case "tables-without-pk":
      return `Table \`${entity}\` is missing a primary key constraint`;
    case "superuser-roles":
      return `Role \`${entity}\` has superuser privileges`;
    case "rls-policies-missing":
      return `Table \`${entity}\` has RLS enabled but zero policies — all access is blocked`;
    case "slow-queries":
      return `Query \`${entity}\` has an average execution time exceeding 1 second`;
    case "unused-indexes":
      return `Index \`${entity}\` has never been scanned`;
    case "table-bloat":
      return `Table \`${entity}\` has significant dead tuple bloat`;
    case "cache-hit-ratio":
      return `Table \`${entity}\` has a cache hit ratio below 99%`;
    case "missing-indexes-on-fk":
      return `Foreign key \`${entity}\` is missing an index`;
    case "disabled-triggers":
      return `Trigger \`${entity}\` is currently disabled`;
    case "indexes-on-low-cardinality":
      return `Index \`${entity}\` targets a low-cardinality column`;
    case "missing-foreign-key-indexes":
      return `Table \`${entity}\` has no indexes at all`;
    case "duplicate-index":
      return `Table \`${entity}\` has duplicate indexes — only one is needed`;
    case "multiple-permissive-policies":
      return `Table \`${entity}\` has multiple permissive policies that OR together, slowing queries`;
    case "auth-rls-initplan":
      return `Policy \`${entity}\` calls auth functions directly instead of wrapping in SELECT`;
    case "function-search-path-mutable":
      return `Function \`${entity}\` has a role mutable search_path`;
    case "security-definer-public":
      return `Function \`${entity}\` is a SECURITY DEFINER callable by unauthenticated users`;
    case "security-definer-authenticated":
      return `Function \`${entity}\` is a SECURITY DEFINER callable by signed-in users`;
    case "leaked-password-protection":
      return "Leaked password protection is currently disabled in Auth settings";
    default:
      return `\`${entity}\` has an issue`;
  }
}

function getSecondaryAction(checkId: string): string {
  switch (checkId) {
    case "tables-without-rls":
    case "tables-without-pk":
    case "rls-policies-missing":
    case "table-bloat":
    case "cache-hit-ratio":
    case "missing-foreign-key-indexes":
      return "View table";
    case "superuser-roles":
      return "View roles";
    case "slow-queries":
      return "View queries";
    case "unused-indexes":
    case "indexes-on-low-cardinality":
    case "duplicate-index":
      return "View indexes";
    case "multiple-permissive-policies":
    case "auth-rls-initplan":
      return "View policies";
    case "disabled-triggers":
      return "View triggers";
    case "function-search-path-mutable":
    case "security-definer-public":
    case "security-definer-authenticated":
      return "View functions";
    case "leaked-password-protection":
      return "Auth settings";
    default:
      return "View in SQL";
  }
}

// Renders text with `backtick-wrapped` spans as inline code pills
function IssueText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <p className="text-sm text-muted-foreground leading-relaxed">
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className="font-mono text-xs text-foreground bg-muted px-1.5 py-0.5 rounded mx-0.5"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdvisorDetailSheet({
  result,
  entity,
  open,
  onOpenChange,
}: {
  result: AdvisorResult | null;
  entity?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!result) return null;

  const { check, sqlStatement } = result;
  const displayEntity = entity && entity !== "—" ? entity : undefined;
  const issueText = displayEntity ? getIssueText(check.id, displayEntity) : check.description;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        contained
        className="overflow-y-auto p-0"
        showCloseButton={false}
      >
        {/* Header */}
        <SheetHeader className="flex flex-row items-start justify-between gap-3 px-5 py-4 border-b border-studio-border">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <SheetTitle className="text-base font-semibold leading-snug">
              {check.title}
            </SheetTitle>
            <span
              className={cn(
                "text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded-full border shrink-0",
                categoryBadgeClass(check.category),
              )}
            >
              {check.category}
            </span>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </SheetHeader>

        {/* Body */}
        <div className="px-5 py-5 space-y-7">
          {/* Entity */}
          {displayEntity && (
            <section>
              <h4 className="text-sm font-semibold mb-2.5">Entity</h4>
              <div className="inline-flex items-center gap-2 bg-muted/60 border border-studio-border rounded-full px-3 py-1.5">
                <EntityIcon checkId={check.id} className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono text-xs text-foreground">{displayEntity}</span>
              </div>
            </section>
          )}

          {/* Issue */}
          <section>
            <h4 className="text-sm font-semibold mb-2.5">Issue</h4>
            <IssueText text={issueText} />
          </section>

          {/* Description */}
          <section>
            <h4 className="text-sm font-semibold mb-2.5">Description</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">{check.description}</p>
          </section>

          {/* SQL fix */}
          {sqlStatement && (
            <section>
              <h4 className="text-sm font-semibold mb-2.5">Fix</h4>
              <pre className="bg-muted/60 border border-studio-border rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {sqlStatement}
              </pre>
            </section>
          )}

          {/* Resolve */}
          <section>
            <h4 className="text-sm font-semibold mb-3">Resolve</h4>
            <div className="flex items-center flex-wrap gap-2">
              {/* Ask Assistant split button */}
              <div className="flex items-stretch">
                <Button
                  size="sm"
                  className="h-8 gap-1.5 rounded-r-none border-r-0 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Ask Assistant
                </Button>
                <Button
                  size="sm"
                  className="h-8 px-2 rounded-l-none text-xs"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                {getSecondaryAction(check.id)}
              </Button>
            </div>
            <button className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors">
              Learn more
              <ExternalLink className="w-3 h-3" />
            </button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
