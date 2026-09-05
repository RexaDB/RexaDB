"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronDown, Copy, Download, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/lib/desktop";
import { buildIntegrationPrompt } from "@/lib/supabase-paykit/integration-prompt";
import type { PaykitDraftState } from "@/lib/supabase-paykit/types";

function BrandLogo({ src, alt }: { src: string; alt: string }) {
  return (
    <Image
      src={src}
      alt={alt}
      width={16}
      height={16}
      className="size-4 shrink-0 dark:invert"
    />
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function exportMarkdown(text: string) {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "billing-prompt.md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CopyPromptButton({
  drafts,
  projectRef,
  triggerClassName,
}: {
  drafts: PaykitDraftState;
  projectRef: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const prompt = buildIntegrationPrompt(drafts, projectRef);

  const copy = async (label = "Prompt copied.") => {
    if (await copyText(prompt)) toast.success(label);
    else toast.error("Copy failed.");
  };

  const openExternal = async (url: string, label: string) => {
    // Very long prompts don't survive URL length limits — copy instead.
    if (prompt.length > 6000) {
      await copy("Prompt too long for a link — copied instead.");
      return;
    }
    setOpen(false);
    await openExternalUrl(`${url}${encodeURIComponent(prompt)}`);
    toast.success(label);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 shrink-0 gap-1.5 text-xs", triggerClassName)}
          title="Copy this billing setup as an AI prompt"
        >
          <Copy className="size-3.5" /> Copy prompt
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => void copy()}>
          <Copy className="size-3.5" /> Copy to clipboard
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            exportMarkdown(prompt);
            setOpen(false);
            toast.success("Exported billing-prompt.md.");
          }}
        >
          <Download className="size-3.5" /> Export Markdown file
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            void openExternal("https://chatgpt.com/?q=", "Opening ChatGPT…")
          }
        >
          <BrandLogo src="/providers/openai.svg" alt="ChatGPT" />
          Open in ChatGPT
          <ExternalLink className="ml-auto size-3 text-muted-foreground" />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            void openExternal("https://claude.ai/new?q=", "Opening Claude…")
          }
        >
          <BrandLogo src="/providers/anthropic_black.svg" alt="Claude" />
          Open in Claude
          <ExternalLink className="ml-auto size-3 text-muted-foreground" />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void copy("Prompt copied — paste it into OpenCode.")}
        >
          <BrandLogo src="/providers/opencode.svg" alt="OpenCode" />
          Copy for OpenCode
          <Check className="ml-auto size-3 text-muted-foreground" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
