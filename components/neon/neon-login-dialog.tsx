"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { streamNeonLogin, type NeonLoginEvent } from "@/lib/neon-cli/client";
import { addNeonCliAccount, type NeonCliAccount } from "@/lib/neon-cli/profile-store";
import { openExternalUrl } from "@/lib/desktop";
import { toast } from "sonner";
import { Loader2, ExternalLink } from "@/lib/icon-theme/lucide-react";

interface NeonLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginComplete: (account: NeonCliAccount) => void;
  /**
   * When set, re-authenticates this existing CLI profile in place instead of
   * minting a new one — used to recover from an expired session without
   * losing the account's identity or any connections pointing at it.
   */
  reconnectProfile?: string | null;
}

function newProfileName(): string {
  const suffix = (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now())
  ).replace(/-/g, "").slice(0, 10);
  return `rexadb-${suffix}`;
}

export function NeonLoginDialog({ open, onOpenChange, onLoginComplete, reconnectProfile }: NeonLoginDialogProps) {
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const profileRef = useRef<string>("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const isReconnect = Boolean(reconnectProfile);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const start = useCallback(() => {
    const profile = reconnectProfile || newProfileName();
    profileRef.current = profile;
    setLines([]);
    setLoginUrl(null);
    setStatus("running");

    abortRef.current = streamNeonLogin(profile, (event: NeonLoginEvent) => {
      if (event.type === "open-url" && event.url) {
        setLoginUrl(event.url);
        void openExternalUrl(event.url);
        setLines((prev) => [...prev, "Opening browser for sign-in..."]);
        return;
      }
      if (event.type === "log" && event.message) {
        setLines((prev) => [...prev, event.message as string]);
        return;
      }
      if (event.type === "done") {
        const account = addNeonCliAccount(profileRef.current);
        toast.success(isReconnect ? "Reconnected to Neon." : "Signed in to Neon.");
        onLoginComplete(account);
        onOpenChange(false);
        setStatus("idle");
        return;
      }
      if (event.type === "error") {
        setStatus("error");
        setLines((prev) => [...prev, event.message || "Login failed."]);
        toast.error(event.message || "Neon login failed.");
      }
    });
  }, [onLoginComplete, onOpenChange, reconnectProfile, isReconnect]);

  useEffect(() => {
    if (open && status === "idle") start();
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setStatus("idle");
      setLines([]);
      setLoginUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      setStatus("idle");
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">
            {isReconnect ? "Reconnect to Neon" : "Sign in with Neon CLI"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            RexaDB launched the real Neon CLI to handle this — a browser
            window opened to Neon's own sign-in page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {loginUrl && (
            <button
              type="button"
              onClick={() => void openExternalUrl(loginUrl)}
              className="flex w-full items-center gap-2 rounded-lg border border-studio-border/60 bg-background/70 px-3 py-2 text-left text-xs text-muted-foreground hover:border-studio-border hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Didn't open? Click to open the sign-in page</span>
            </button>
          )}

          <div
            ref={logRef}
            className="h-40 overflow-y-auto rounded-lg border border-studio-border/60 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {lines.length === 0 ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Starting neon auth...
              </div>
            ) : (
              lines.map((line, i) => <div key={i}>{line}</div>)
            )}
          </div>

          {status === "error" && (
            <Button
              onClick={start}
              className="w-full h-9 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
