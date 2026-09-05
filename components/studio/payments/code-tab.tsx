"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import {
  buildManualInstructions,
  buildProductsTs,
  hashPaykitDrafts,
} from "@/lib/supabase-paykit/codegen";
import { PAYKIT_SCHEMA_VERSION } from "@/lib/supabase-paykit/paykit-sql";
import type { PaykitDraftState } from "@/lib/supabase-paykit/types";

interface CodeTabProps {
  drafts: PaykitDraftState;
  projectRef: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export function CodeTab({ drafts, projectRef }: CodeTabProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const productsTs = useMemo(() => buildProductsTs(drafts), [drafts]);
  const manual = useMemo(() => buildManualInstructions(projectRef), [projectRef]);
  const hash = useMemo(() => hashPaykitDrafts(drafts), [drafts]);

  const onCopy = async (key: string, text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="rounded border border-studio-border/60 px-1.5 py-px font-mono">
          hash {hash}
        </span>
        <span className="rounded border border-studio-border/60 px-1.5 py-px font-mono">
          {PAYKIT_SCHEMA_VERSION}
        </span>
      </div>

      <SectionHeader
        title="products.ts"
        hint="Source of truth synced to Stripe + paykit schema"
        copied={copied === "products"}
        onCopy={() => onCopy("products", productsTs)}
      />
      <pre className="max-h-64 overflow-auto rounded-xl border border-studio-border/60 bg-black/30 p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-all">
        {productsTs}
      </pre>

      <SectionHeader
        title="Manual fallback"
        hint="CLI steps when automation can't run"
        copied={copied === "manual"}
        onCopy={() => onCopy("manual", manual)}
      />
      <pre className="max-h-64 overflow-auto rounded-xl border border-studio-border/60 bg-black/30 p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-all">
        {manual}
      </pre>
    </div>
  );
}

function SectionHeader({
  title,
  hint,
  copied,
  onCopy,
}: {
  title: string;
  hint: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{title}</p>
        <p className="truncate text-[10px] text-muted-foreground">{hint}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 gap-1 text-[11px]"
        onClick={onCopy}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
