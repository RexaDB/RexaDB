"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "@/lib/icon-theme/lucide-react";
import { version } from "../package.json";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { useGlobalAppFontFamily } from "@/hooks/use-global-app-font-family";
import { supabase } from "@/lib/supabase/client";
import { getStoredUserProfile } from "@/lib/api/actions-client";
import {
  activateLocalUserProfile,
  LOCAL_MODE_STORAGE_KEY,
  LOCAL_NAME_STORAGE_KEY,
  syncAuthenticatedUserProfile,
} from "@/lib/auth/user-profile";
import { toast } from "sonner";

export function AuthPage() {
  useGlobalAppTheme(false);
  useGlobalAppFontFamily();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect_to") || undefined;
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [fullName, setFullName] = useState("");
  const [localDisplayName, setLocalDisplayName] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const checkSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        console.log(
          "[AUTH TRACE] auth-page checkSession, hasSession:",
          !!data.session?.user,
          "user:",
          data.session?.user?.email || "null",
        );
        if (data.session?.user) {
          void syncAuthenticatedUserProfile(data.session.user);
        }
        // If user already has a session, let them stay — no redirect, no signout.
        // They can sign in again (to switch accounts) or go back.
      } catch (error) {
        console.error("[AUTH TRACE] Session check failed:", error);
      } finally {
        setIsAuthLoading(false);
      }
    };

    void checkSession();
  }, [redirectTo]);

  const handleGoBack = async () => {
    if (redirectTo && redirectTo !== "/" && redirectTo !== "/?") {
      window.location.href = redirectTo;
      return;
    }

    const stored = window.localStorage.getItem(LOCAL_MODE_STORAGE_KEY);
    const storedName = window.localStorage.getItem(LOCAL_NAME_STORAGE_KEY);

    if (stored === "1" && storedName && storedName.trim()) {
      window.location.href = "/";
      return;
    }

    const profileRes = await getStoredUserProfile("local");
    if (profileRes.success && profileRes.data) {
      window.location.href = "/";
      return;
    }

    window.location.href = "/";
  };

  const handleRequestOtp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error("Please enter your email.");
      return;
    }

    if (authMode === "sign-up" && !fullName.trim()) {
      toast.error("Please enter your name.");
      return;
    }

    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: authMode === "sign-up",
        data: authMode === "sign-up" ? { name: fullName.trim() } : undefined,
      },
    });
    setAuthLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setOtpSent(true);
    toast.success("We sent a 6-digit OTP to your email.");
  };

  const handleVerifyOtp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = otp.trim();

    if (!/^\d{6}$/.test(token)) {
      toast.error("Enter a valid 6-digit OTP.");
      return;
    }

    setAuthLoading(true);
    console.log("[AUTH TRACE] verifyOtp starting...");
    const { data: otpData, error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token,
      type: authMode === "sign-up" ? "signup" : "email",
    });
    setAuthLoading(false);

    if (error) {
      console.log("[AUTH TRACE] verifyOtp error:", error.message);
      toast.error(error.message);
      return;
    }

    // Use session directly from verifyOtp response (avoid getSession() which
    // can fail in Tauri's custom protocol when storage hasn't persisted yet)
    const session = otpData?.session;
    const user = session?.user ?? null;
    if (!user) {
      toast.error(
        "Authentication succeeded, but no session user was available.",
      );
      return;
    }

    console.log("[AUTH TRACE] verifyOtp success, user:", user.email);

    const syncResult = await syncAuthenticatedUserProfile(user);
    if (!syncResult.result.success) {
      toast.error(
        syncResult.result.error ||
          "Authentication succeeded, but your local profile did not sync.",
      );
      return;
    }

    setOtp("");
    setOtpSent(false);
    toast.success("Authentication successful.");
    window.location.href = redirectTo || "/";
  };

  const handleContinueLocal = async () => {
    const trimmed = localDisplayName.trim();
    if (!trimmed) {
      toast.error("Enter a display name to continue locally.");
      return;
    }
    console.log("[AUTH TRACE] handleContinueLocal, name:", trimmed);
    // Clear any stale Supabase session so local mode is clean
    await supabase.auth.signOut().catch(() => {});
    console.log("[AUTH TRACE] handleContinueLocal signOut done");
    const localResult = await activateLocalUserProfile(trimmed);
    console.log(
      "[AUTH TRACE] handleContinueLocal upsert result:",
      JSON.stringify(localResult.result),
    );
    if (!localResult.result.success) {
      toast.error(
        localResult.result.error || "Failed to switch to local mode.",
      );
      return;
    }
    window.location.href = "/";
  };

  if (isAuthLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-studio-bg text-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-lg border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-studio-bg text-foreground overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-studio-row-hover/60 via-studio-bg to-studio-bg"></div>

      <div className="relative z-10 flex w-full items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-3 mb-8">
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={handleGoBack}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 text-center pr-9">
              <h1 className="text-sm font-bold tracking-tight">
                Login or Sign Up
              </h1>
            </div>
          </div>

          <div className="bg-studio-bg/80 border border-studio-border/60 rounded-lg p-6 backdrop-blur-xl shadow-xl">
            <div className="flex gap-2 mb-6 bg-muted/40 p-1 rounded-lg">
              <Button
                variant="ghost"
                className={`flex-1 ${authMode === "sign-in" ? "bg-accent text-accent-foreground hover:bg-accent/80" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => {
                  setAuthMode("sign-in");
                  setOtpSent(false);
                }}
              >
                Sign In
              </Button>
              <Button
                variant="ghost"
                className={`flex-1 ${authMode === "sign-up" ? "bg-accent text-accent-foreground hover:bg-accent/80" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => {
                  setAuthMode("sign-up");
                  setOtpSent(false);
                }}
              >
                Sign Up
              </Button>
            </div>

            <form
              onSubmit={otpSent ? handleVerifyOtp : handleRequestOtp}
              className="space-y-4"
            >
              {authMode === "sign-up" && !otpSent && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <Input
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="bg-background/70 border-border/60 h-10 focus:border-border"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  type="email"
                  placeholder="john@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-background/70 border-border/60 h-10 focus:border-border"
                />
              </div>

              {otpSent && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Verification Code
                  </Label>
                  <Input
                    inputMode="numeric"
                    placeholder="123456"
                    value={otp}
                    onChange={(e) =>
                      setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    className="bg-background/70 border-border/60 h-10 tracking-widest text-center text-sm"
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Check your inbox
                  </p>
                </div>
              )}

              <Button
                type="submit"
                disabled={authLoading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10 font-medium"
              >
                {authLoading
                  ? "Processing..."
                  : otpSent
                    ? "Verify"
                    : "Continue with Email"}
              </Button>
            </form>
            <div className="mt-4">
              <div className="space-y-1.5 mb-3">
                <Label className="text-xs text-muted-foreground">
                  Local display name
                </Label>
                <Input
                  placeholder="Your name"
                  value={localDisplayName}
                  onChange={(e) => setLocalDisplayName(e.target.value)}
                  className="bg-background/70 border-border/60 h-10 focus:border-border"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full bg-background/70 border-border/60 text-foreground/80 hover:text-foreground hover:bg-muted/50 h-10"
                onClick={handleContinueLocal}
              >
                Continue Locally
              </Button>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Version {version}
          </p>
        </div>
      </div>
    </div>
  );
}
