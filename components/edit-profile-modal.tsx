"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FallbackAvatar from "@/components/fallback-avatar";
import { cn } from "@/lib/utils";

export type PlanTier = "free" | "pro" | "team" | "enterprise" | "otl";

export interface ProfileData {
  fullName: string;
  email: string;
  avatarUrl?: string;
  plan: PlanTier;
  daysRemaining?: number;
}

export interface EditProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: ProfileData;
  lastUpdated?: string;
  onSave: (data: ProfileData) => void | Promise<void>;
  onUpgrade?: () => void;
  onRefreshSubscription?: () => void | Promise<void>;
  onAvatarEdit?: () => void;
}

const PLAN_LABEL: Record<PlanTier, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
  otl: "Lifetime",
};

export function EditProfileModal({
  open,
  onOpenChange,
  profile,
  lastUpdated,
  onSave,
  onUpgrade,
  onRefreshSubscription,
  onAvatarEdit,
}: EditProfileModalProps) {
  const [draft, setDraft] = useState<ProfileData>(profile);
  const [planOpen, setPlanOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setDraft(profile);
  }, [open, profile]);

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((d) => ({ ...d, avatarUrl: reader.result as string }));
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRefresh = async () => {
    if (!onRefreshSubscription) return;
    setRefreshing(true);
    try {
      await onRefreshSubscription();
    } finally {
      setRefreshing(false);
    }
  };

  const isSubscribed = draft.plan !== "free" && draft.plan != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl gap-0 rounded-2xl p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="px-8 pt-6 pb-5">
          <DialogTitle className="text-base font-semibold">Edit your profile</DialogTitle>
        </div>

        <div className="grid grid-cols-[1fr_280px] gap-8 px-8 pb-8">
          {/* Left: form */}
          <div className="space-y-5 border-r border-dashed border-border pr-8">
            <Field label="Full name">
              <Input
                value={draft.fullName}
                onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                className="rounded-xl"
              />
            </Field>

            <Field label="Email">
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className="rounded-xl"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs font-normal">Plan</Label>
                <button
                  type="button"
                  onClick={() => setPlanOpen((v) => !v)}
                  className={cn(
                    "border-input bg-background flex h-10 w-full items-center justify-between rounded-xl border px-3 text-sm transition-colors hover:bg-accent/40",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {isSubscribed && <Sparkles className="h-3.5 w-3.5" />}
                    {PLAN_LABEL[draft.plan]}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      planOpen && "rotate-180",
                    )}
                  />
                </button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs font-normal">Subscription</Label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRefresh}
                  disabled={refreshing || !onRefreshSubscription}
                  className="h-10 w-full justify-between rounded-xl px-3 font-normal"
                >
                  <span>Refresh</span>
                  <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                </Button>
              </div>
            </div>

            {planOpen && (
              <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                {isSubscribed ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{PLAN_LABEL[draft.plan]} plan</div>
                      <div className="text-muted-foreground text-xs">
                        {draft.daysRemaining ?? 0} days remaining
                      </div>
                    </div>
                    {onUpgrade && draft.plan !== "team" && (
                      <Button size="sm" variant="ghost" onClick={onUpgrade} className="h-8">
                        Upgrade
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">You're on the Free plan</div>
                      <div className="text-muted-foreground text-xs">
                        Upgrade to unlock more features
                      </div>
                    </div>
                    <Button size="sm" onClick={onUpgrade} className="h-8 rounded-full">
                      Upgrade
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: preview */}
          <div className="flex flex-col items-center pt-1">
            <div className="text-muted-foreground mb-3 text-xs">Preview</div>
            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarFile}
              />
              <button
                type="button"
                onClick={handleAvatarClick}
                className="bg-muted h-24 w-24 overflow-hidden rounded-full focus:outline-none"
                aria-label="Change avatar"
              >
                {draft.avatarUrl ? (
                  <img
                    src={draft.avatarUrl}
                    alt={draft.fullName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <FallbackAvatar
                    name={draft.fullName || "User"}
                    size={96}
                    className="h-full w-full"
                  />
                )}
              </button>
              <button
                type="button"
                onClick={handleAvatarClick}
                className="bg-background absolute right-0 bottom-0 flex h-7 w-7 items-center justify-center rounded-full border border-border shadow-sm hover:bg-accent"
                aria-label="Edit avatar"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-3 text-center">
              <div className="text-base font-semibold">{draft.fullName || "Your name"}</div>
              <div className="text-muted-foreground text-sm">{PLAN_LABEL[draft.plan]} plan</div>
            </div>
            {isSubscribed && draft.daysRemaining != null && (
              <div className="bg-muted text-muted-foreground mt-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs">
                <Sparkles className="h-3 w-3" />
                {draft.daysRemaining} days left
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-8 py-5">
          <div className="text-muted-foreground text-xs">
            {lastUpdated ? `Last updated: ${lastUpdated}` : ""}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-full">
              Cancel
            </Button>
            <Button
              onClick={() => onSave(draft)}
              className="rounded-full bg-foreground text-background hover:bg-foreground/90"
            >
              Save changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs font-normal">{label}</Label>
      {children}
    </div>
  );
}
