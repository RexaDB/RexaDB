"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { createSpacetimeDbLoginSession } from "@/lib/spacetimedb-mgmt/auth";
import {
  addSpacetimeDbMgmtAccount,
  type SpacetimeDbMgmtAccount,
} from "@/lib/spacetimedb-mgmt/token-store";
import { DEFAULT_SPACETIMEDB_CLOUD_HOST } from "@/lib/spacetimedb-mgmt/client";
import { openExternalUrl } from "@/lib/desktop";
import { toast } from "sonner";
import { Loader2, ExternalLink } from "@/lib/icon-theme/lucide-react";

interface SpacetimeDbLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginComplete: (token: string, account: SpacetimeDbMgmtAccount) => void;
}

export function SpacetimeDbLoginDialog({
  open,
  onOpenChange,
  onLoginComplete,
}: SpacetimeDbLoginDialogProps) {
  const [phase, setPhase] = useState<"init" | "waiting" | "done">("init");
  const [host, setHost] = useState(DEFAULT_SPACETIMEDB_CLOUD_HOST);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("init");
    setLoading(false);
  }, []);

  const handleStartLogin = useCallback(async () => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const session = await createSpacetimeDbLoginSession();
      if (runIdRef.current !== runId) return;
      setPhase("waiting");
      await openExternalUrl(session.loginUrl);
      const token = await session.pollStatus(undefined, controller.signal);
      if (runIdRef.current !== runId) return;
      const account = addSpacetimeDbMgmtAccount(token, { host });
      setPhase("done");
      setLoading(false);
      toast.success("Logged in to SpacetimeDB.");
      onLoginComplete(token, account);
      onOpenChange(false);
      reset();
    } catch (err) {
      if (runIdRef.current !== runId) return;
      setLoading(false);
      setPhase("init");
      toast.error(
        err instanceof Error ? err.message : "SpacetimeDB login failed. Try again.",
      );
    }
  }, [host, onLoginComplete, onOpenChange, reset]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">
            Connect SpacetimeDB Account
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {phase === "init"
              ? "Log in with GitHub to link your SpacetimeDB identity and browse your databases."
              : "Waiting for the SpacetimeDB browser flow to approve this login."}
          </DialogDescription>
        </DialogHeader>

        {phase === "init" ? (
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              This opens spacetimedb.com in your browser. Once you sign in, the
              app detects it automatically and links your account.
            </p>
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start px-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide" : "Advanced"} — server host
            </Button>
            {showAdvanced && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Cloud / server host
                </Label>
                <Input
                  placeholder="maincloud.spacetimedb.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value.trim())}
                  className="bg-background/70 border-border/60 h-10 font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Used to list your databases (like{" "}
                  <code className="text-[10px]">
                    spacetime server add --url
                  </code>
                  ). Login always happens on spacetimedb.com.
                </p>
              </div>
            )}
            <Button
              onClick={handleStartLogin}
              disabled={loading || !host}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10 font-medium"
            >
              {loading ? "Opening browser..." : "Log in to SpacetimeDB"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/40 p-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Waiting for approval… this usually takes a few seconds.
              </span>
            </div>
            <Button
              variant="outline"
              className="w-full h-9 gap-2 text-muted-foreground"
              onClick={() => openExternalUrl("https://spacetimedb.com")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open spacetimedb.com
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground hover:text-foreground"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}