"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NeonLogo } from "@/components/shared/provider-logo";
import { openExternalUrl } from "@/lib/desktop";
import {
  Copy,
  Check,
  Terminal,
  ExternalLink,
  RefreshCw,
  Loader2,
} from "@/lib/icon-theme/lucide-react";

const INSTALL_COMMAND = "npm install -g neonctl";

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; nothing to fall back to
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group flex w-full items-center gap-3 rounded-lg border border-studio-border/60 bg-background/70 px-4 py-3 text-left font-mono text-sm transition-colors hover:border-studio-border"
      title="Copy to clipboard"
    >
      <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{command}</span>
      <span className="shrink-0 text-muted-foreground group-hover:text-foreground">
        {copied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </span>
    </button>
  );
}

export function NeonInstallPrompt({
  onRecheck,
  checking,
}: {
  onRecheck: () => void;
  checking: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center rounded-xl border border-studio-border/60 bg-studio-bg/60 px-8 py-12 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-studio-border/60 bg-background/60">
        <NeonLogo className="h-8 w-8" />
      </div>

      <h3 className="text-sm font-semibold">Install the Neon CLI</h3>
      <p className="mt-2 max-w-sm text-xs text-muted-foreground">
        Signing in with your Neon account uses Neon's own official CLI to
        handle login — install it once and RexaDB can browse and connect
        your projects directly.
      </p>

      <div className="mt-6 w-full space-y-3">
        <CopyableCommand command={INSTALL_COMMAND} />

        <div className="flex items-center gap-2 pt-1">
          <div className="h-px flex-1 bg-studio-border/50" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            or
          </span>
          <div className="h-px flex-1 bg-studio-border/50" />
        </div>

        <Button
          variant="outline"
          className="h-9 w-full gap-2 text-xs"
          onClick={() => openExternalUrl("https://neon.com/docs/reference/neon-cli")}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          View install docs
        </Button>
      </div>

      <Button
        onClick={onRecheck}
        disabled={checking}
        className="mt-6 h-9 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {checking ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {checking ? "Checking..." : "I've installed it — check again"}
      </Button>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Prefer not to install anything? You can still add a Neon connection
        by pasting its connection string from the Neon console.
      </p>
    </div>
  );
}
