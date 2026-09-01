"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { createLoginSession } from "@/lib/planetscale/auth";
import { addPlanetscaleAccount, type PlanetscaleAccount } from "@/lib/planetscale/token-store";
import { openExternalUrl } from "@/lib/desktop";
import { Check, Copy, Loader2 } from "@/lib/icon-theme/lucide-react";
import { toast } from "sonner";

interface PlanetscaleLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginComplete: (account: PlanetscaleAccount) => void;
}

export function PlanetscaleLoginDialog({
  open,
  onOpenChange,
  onLoginComplete,
}: PlanetscaleLoginDialogProps) {
  const [waiting, setWaiting] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelledRef = useRef(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetCopyState = () => {
    setCopied(false);
    if (copyResetRef.current) {
      clearTimeout(copyResetRef.current);
      copyResetRef.current = null;
    }
  };

  const handleStartLogin = useCallback(async () => {
    cancelledRef.current = false;
    resetCopyState();
    setWaiting(true);
    setAuthUrl(null);
    try {
      const session = await createLoginSession();
      setAuthUrl(session.url);
      try {
        await openExternalUrl(session.url);
      } catch {
        // Browser open can fail in desktop shells — user can still copy the link.
      }
      const tokens = await session.waitForCompletion();
      if (cancelledRef.current) return;
      const account = addPlanetscaleAccount(tokens);
      toast.success("Logged in to PlanetScale.");
      onLoginComplete(account);
      onOpenChange(false);
    } catch (err) {
      if (!cancelledRef.current) {
        toast.error(err instanceof Error ? err.message : "Failed to log in to PlanetScale");
      }
    } finally {
      setWaiting(false);
      setAuthUrl(null);
      resetCopyState();
    }
  }, [onLoginComplete, onOpenChange]);

  const handleCopyLink = useCallback(async () => {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      setCopied(true);
      toast.success("Login link copied.");
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy link. Select and copy it manually.");
    }
  }, [authUrl]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      cancelledRef.current = true;
      setWaiting(false);
      setAuthUrl(null);
      resetCopyState();
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">Connect PlanetScale Account</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Log in to your PlanetScale account to browse and connect your databases —
            no connection strings or passwords to type.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {waiting ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">
                Waiting for you to finish in the browser...
              </p>
              {authUrl && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-9 text-xs"
                  onClick={handleCopyLink}
                >
                  {copied ? (
                    <Check className="mr-2 h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="mr-2 h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy login link"}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              This opens PlanetScale in your browser. Once you authorize RexaDB, you&apos;ll
              be brought back here automatically.
            </p>
          )}
          <Button
            onClick={handleStartLogin}
            disabled={waiting}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10 font-medium"
          >
            {waiting ? "Waiting..." : "Log in to PlanetScale"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
