"use client";

import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Check, ChevronLeft } from "@/lib/icon-theme/lucide-react";
import { BUILTIN_APP_THEMES } from "@/lib/studio/app-themes";
import { supabase } from "@/lib/supabase/client";
import {
  activateLocalUserProfile,
  syncAuthenticatedUserProfile,
} from "@/lib/auth/user-profile";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Step = "welcome" | "theme" | "account";

const STEPS: Step[] = ["welcome", "theme", "account"];

const DARK_THEME = BUILTIN_APP_THEMES.find((t) => t.id === "zinc-dark-white");
const DARK_THEME_ID = DARK_THEME?.id ?? "dark";

const TIPS: string[] = [
  "RexaDB connects to Postgres, Supabase, SpacetimeDB, Neon, SQLite and more — all from one unified workspace.",
  "Turn on Schema Explorer in Settings to browse tables, functions, triggers and indexes without leaving the sidebar.",
  "You can pin favorite tables and queries for quick access from the sidebar.",
  "Export query results as CSV or JSON with a single click from the results grid.",
];

const APPEARANCE_OPTIONS: { id: string; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: DARK_THEME_ID, label: "Dark" },
];

// Themed via CSS variable tokens (same ones the rest of the app uses) so the
// onboarding chrome matches whatever appearance is currently active — light,
// dark, or a custom app theme — including live as the user picks one on the
// theme step.
const PRIMARY_BTN =
  "flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";
const OUTLINE_BTN =
  "flex h-11 w-full items-center justify-center rounded-xl border border-border/60 bg-background/70 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50";

function OptionPill({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary" : "border-border",
        )}
      >
        {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
      </span>
      {label}
    </button>
  );
}

export function OnboardingFlow({
  open,
  appThemeId,
  setAppThemeId,
  onComplete,
}: {
  open: boolean;
  appThemeId: string;
  setAppThemeId: (id: string) => void;
  onComplete: (info: { name: string; email?: string }) => void;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [localName, setLocalName] = useState("");
  const [loading, setLoading] = useState(false);

  const stepIndex = STEPS.indexOf(step);

  function goTo(next: Step) {
    setStep(next);
  }

  function goBack() {
    if (step === "theme") goTo("welcome");
    else if (step === "account") goTo("theme");
  }

  async function handleRequestOtp(e: FormEvent<HTMLFormElement>) {
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

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: authMode === "sign-up",
        data: authMode === "sign-up" ? { name: fullName.trim() } : undefined,
      },
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setOtpSent(true);
    toast.success("We sent a 6-digit OTP to your email.");
  }

  async function handleVerifyOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = otp.trim();
    if (!/^\d{6}$/.test(token)) {
      toast.error("Enter a valid 6-digit OTP.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token,
      type: authMode === "sign-up" ? "signup" : "email",
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const user = data?.session?.user ?? null;
    if (!user) {
      toast.error("Authentication succeeded, but no session user was available.");
      return;
    }

    const synced = await syncAuthenticatedUserProfile(user);
    if (!synced.result.success) {
      toast.error(synced.result.error || "Signed in, but your profile did not sync yet.");
    }

    toast.success("You're all set.");
    onComplete({ name: synced.name || fullName.trim() || user.email || "User", email: user.email ?? undefined });
  }

  async function handleContinueFree() {
    const trimmed = localName.trim();
    if (!trimmed) {
      toast.error("Enter a display name to continue.");
      return;
    }
    setLoading(true);
    await supabase.auth.signOut().catch(() => {});
    const result = await activateLocalUserProfile(trimmed);
    setLoading(false);
    if (!result.result.success) {
      toast.error(result.result.error || "Failed to continue. Try again.");
      return;
    }
    toast.success(`Welcome, ${trimmed}.`);
    onComplete({ name: trimmed });
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        hideCloseButton
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="w-[94vw] h-[86vh] max-w-[1200px] sm:max-w-[1200px] gap-0 overflow-hidden rounded-2xl border border-border bg-studio-bg p-0 text-foreground"
      >
        <DialogTitle className="sr-only">Welcome to RexaDB</DialogTitle>
        <DialogDescription className="sr-only">
          Set up RexaDB: pick an appearance and sign in or continue for free.
        </DialogDescription>

        <div className="flex h-full">
          {/* Visual panel */}
          <div className="relative m-3 hidden w-[42%] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-sidebar via-studio-bg to-muted md:flex">
            <img
              src="/onboarding.png"
              alt="RexaDB onboarding"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-black/40" />
            <div className="absolute top-14 left-0 right-0 z-10 max-w-xs mx-auto px-8 text-center">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-white/70">
                Tip
              </p>
              <p className="text-lg leading-relaxed text-white/90">
                {TIPS[stepIndex % TIPS.length]}
              </p>
            </div>
          </div>

          {/* Content panel */}
          <div className="relative flex flex-1 flex-col px-10 py-10 md:px-14">
            {step !== "welcome" && (
              <button
                type="button"
                onClick={goBack}
                aria-label="Back"
                className="absolute left-6 top-6 flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground md:left-10 md:top-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}

            <div className="flex flex-1 flex-col justify-center gap-6 max-w-md">
              {step === "welcome" && (
                <>
                  <div className="space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight">
                      Welcome to RexaDB
                    </h1>
                    <p className="text-muted-foreground">
                      Let&apos;s get your workspace set up. This will only take a
                      moment.
                    </p>
                  </div>
                  <button type="button" className={PRIMARY_BTN} onClick={() => goTo("theme")}>
                    Get Started
                  </button>
                </>
              )}

              {step === "theme" && (
                <>
                  <div className="space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight">
                      Which look works for you?
                    </h1>
                    <p className="text-muted-foreground">
                      You can change this anytime in Settings.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {APPEARANCE_OPTIONS.map((option) => (
                      <OptionPill
                        key={option.id}
                        label={option.label}
                        selected={appThemeId === option.id}
                        onClick={() => setAppThemeId(option.id)}
                      />
                    ))}
                  </div>

                  <button type="button" className={PRIMARY_BTN} onClick={() => goTo("account")}>
                    Continue
                  </button>
                </>
              )}

              {step === "account" && (
                <>
                  <div className="space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight">
                      Sign in or continue free
                    </h1>
                    <p className="text-muted-foreground">
                      Sync your connections across devices, or stay fully local.
                    </p>
                  </div>

                  <div className="flex gap-2 rounded-xl bg-muted/40 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("sign-up");
                        setOtpSent(false);
                      }}
                      className={cn(
                        "flex-1 rounded-lg py-2 text-sm font-medium transition-colors",
                        authMode === "sign-up"
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Sign Up
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("sign-in");
                        setOtpSent(false);
                      }}
                      className={cn(
                        "flex-1 rounded-lg py-2 text-sm font-medium transition-colors",
                        authMode === "sign-in"
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Sign In
                    </button>
                  </div>

                  <form onSubmit={otpSent ? handleVerifyOtp : handleRequestOtp} className="space-y-3">
                    {authMode === "sign-up" && !otpSent && (
                      <Input
                        placeholder="Your name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="h-11 border-border/60 bg-background/70"
                      />
                    )}
                    {!otpSent && (
                      <Input
                        type="email"
                        placeholder="john@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-11 border-border/60 bg-background/70"
                      />
                    )}
                    {otpSent && (
                      <div className="space-y-1.5">
                        <Input
                          inputMode="numeric"
                          placeholder="123456"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          className="h-11 border-border/60 bg-background/70 text-center tracking-widest"
                        />
                        <p className="text-center text-xs text-muted-foreground">Check your inbox</p>
                      </div>
                    )}
                    <button type="submit" disabled={loading} className={PRIMARY_BTN}>
                      {loading ? "Processing..." : otpSent ? "Verify" : "Continue with Email"}
                    </button>
                  </form>

                  <div className="relative py-0.5">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border/60" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-studio-bg px-2 text-muted-foreground">or</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Input
                      placeholder="Your name"
                      value={localName}
                      onChange={(e) => setLocalName(e.target.value)}
                      className="h-11 border-border/60 bg-background/70"
                    />
                    <button
                      type="button"
                      disabled={loading}
                      className={OUTLINE_BTN}
                      onClick={handleContinueFree}
                    >
                      Continue Free
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    "h-1 w-8 rounded-full transition-all",
                    i === stepIndex
                      ? "bg-primary"
                      : i < stepIndex
                        ? "bg-primary/50"
                        : "bg-muted",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
