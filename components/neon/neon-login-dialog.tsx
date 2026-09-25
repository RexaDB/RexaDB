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
import { streamNeonLogin, getNeonAuthStatus, type NeonLoginEvent, type NeonAuthStatus } from "@/lib/neon-cli/client";
import { addNeonCliAccount, getNeonCliAccounts, type NeonCliAccount } from "@/lib/neon-cli/profile-store";
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
  const [status, setStatus] = useState<"idle" | "checking" | "signed-in" | "running" | "error">("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [existingSession, setExistingSession] = useState<NeonAuthStatus | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const profileRef = useRef<string>("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const isReconnect = Boolean(reconnectProfile);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const start = useCallback(() => {
    // One profile per dialog session (reconnect reuses its own): every
    // attempt used to mint a fresh random profile, littering
    // credentials.rexadb-*.json files and defeating single-flight —
    // overlapping flows then raced each other's OAuth state/CSRF.
    if (!profileRef.current) {
      profileRef.current = reconnectProfile || newProfileName();
    }
    const profile = profileRef.current;
    setLines([]);
    setFatalError(null);
    setExistingSession(null);
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
        const message = event.message || "Login failed.";
        setStatus("error");
        setFatalError(message);
        setLines((prev) => [...prev, message]);
        toast.error(message);
      }
    });
  }, [onLoginComplete, onOpenChange, reconnectProfile, isReconnect]);

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Before forcing another OAuth dance, check whether the CLI already
  // holds a valid session (e.g. signed in via terminal, or a previous
  // RexaDB login). If so, offer Continue instead of re-authenticating.
  // Generation-guarded: a slow check from a previous open must never
  // overwrite a newer session or start a login that kills the current
  // OAuth flow via single-flight.
  const checkGenRef = useRef(0);
  const checkExistingSession = useCallback(async () => {
    const gen = ++checkGenRef.current;
    setStatus("checking");
    setFatalError(null);
    setExistingSession(null);
    const alive = () => openRef.current && checkGenRef.current === gen;
    try {
      const candidates = reconnectProfile
        ? [reconnectProfile]
        : [...getNeonCliAccounts().map((a) => a.profileName), "DEFAULT"];
      const statuses = await getNeonAuthStatus(candidates);
      if (!alive()) return;
      const usable = statuses.find((s) => s.valid);
      if (usable) {
        setExistingSession(usable);
        setStatus("signed-in");
        return;
      }
    } catch {
      // status check is best-effort — fall through to a fresh login
    }
    if (alive()) start();
  }, [reconnectProfile, start]);

  useEffect(() => {
    if (open && status === "idle") void checkExistingSession();
    if (!open) {
      checkGenRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      profileRef.current = "";
      setStatus("idle");
      setFatalError(null);
      setExistingSession(null);
      setLines([]);
      setLoginUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleContinueSession = useCallback(() => {
    if (!existingSession) return;
    const account = addNeonCliAccount(
      existingSession.profile,
      existingSession.email ?? null,
    );
    toast.success(`Continuing as ${existingSession.email ?? existingSession.profile}.`);
    onLoginComplete(account);
    onOpenChange(false);
    setStatus("idle");
  }, [existingSession, onLoginComplete, onOpenChange]);

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
            {status === "signed-in"
              ? "A valid Neon CLI session was found — continue with it or sign in fresh."
              : "RexaDB launched the real Neon CLI to handle this — a browser window opened to Neon's own sign-in page."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {status === "checking" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking for an existing Neon sign-in...
            </div>
          )}

          {status === "signed-in" && existingSession && (
            <div className="space-y-3">
              <div className="rounded-lg border border-studio-border/60 bg-background/70 px-3 py-2.5 text-xs">
                <div className="font-medium text-foreground">
                  Already signed in{existingSession.email ? ` as ${existingSession.email}` : ""}
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  Neon CLI profile “{existingSession.profile}” holds a valid session — no browser dance needed.
                </div>
              </div>
              <Button
                onClick={handleContinueSession}
                className="w-full h-9 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Continue{existingSession.email ? ` as ${existingSession.email}` : ""}
              </Button>
              <button
                type="button"
                onClick={start}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Use a different account instead
              </button>
            </div>
          )}

          {(status === "running" || status === "error") && (
            <>
          {status === "running" && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Keep this dialog open until the browser tab finishes — closing it
              cancels the sign-in. If you retried, authorize in the newest tab
              and close any older Neon tabs first.
            </p>
          )}
          {fatalError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
              {fatalError}
            </div>
          )}
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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
