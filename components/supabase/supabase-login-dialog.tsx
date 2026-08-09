"use client";

import { useState, useCallback } from "react";
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
import { createLoginSession } from "@/lib/supabase-mgmt/auth";
import {
  addMgmtAccount,
  type SupabaseMgmtAccount,
} from "@/lib/supabase-mgmt/token-store";
import { openExternalUrl } from "@/lib/desktop";
import { toast } from "sonner";

interface SupabaseLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginComplete: (token: string, account: SupabaseMgmtAccount) => void;
}

export function SupabaseLoginDialog({
  open,
  onOpenChange,
  onLoginComplete,
}: SupabaseLoginDialogProps) {
  const [step, setStep] = useState<"init" | "code">("init");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<Awaited<
    ReturnType<typeof createLoginSession>
  > | null>(null);

  const handleStartLogin = useCallback(async () => {
    setLoading(true);
    try {
      const loginSession = await createLoginSession();
      setSession(loginSession);
      setStep("code");
      await openExternalUrl(loginSession.url);
      toast.success("Browser opened. Log in to Supabase and paste the code.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start login flow",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmitCode = useCallback(async () => {
    if (!session) return;
    const trimmed = code.trim();
    if (trimmed.length !== 8) {
      toast.error("Code must be exactly 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const token = await session.submit(trimmed);
      const account = addMgmtAccount(token);
      toast.success("Logged in to Supabase.");
      onLoginComplete(token, account);
      onOpenChange(false);
      setStep("init");
      setCode("");
      setSession(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Login failed. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [session, code, onLoginComplete, onOpenChange]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep("init");
      setCode("");
      setSession(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">
            Connect Supabase Account
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {step === "init"
              ? "Log in to your Supabase account to browse and connect your projects."
              : "Enter the 8-character code from the Supabase dashboard."}
          </DialogDescription>
        </DialogHeader>

        {step === "init" ? (
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              This opens the Supabase dashboard in your browser. You'll get a
              verification code to paste back here.
            </p>
            <Button
              onClick={handleStartLogin}
              disabled={loading}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10 font-medium"
            >
              {loading ? "Opening browser..." : "Log in to Supabase"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Verification Code
              </Label>
              <Input
                placeholder="XXXXXXXX"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().slice(0, 8))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmitCode();
                }}
                className="bg-background/70 border-border/60 h-10 tracking-widest text-center text-sm font-mono"
                maxLength={8}
                autoFocus
              />
              <p className="text-xs text-muted-foreground text-center">
                Check your browser for the code
              </p>
            </div>
            <Button
              onClick={handleSubmitCode}
              disabled={loading || code.trim().length !== 8}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10 font-medium"
            >
              {loading ? "Verifying..." : "Submit Code"}
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground hover:text-foreground"
              onClick={() => setStep("init")}
            >
              Back
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
