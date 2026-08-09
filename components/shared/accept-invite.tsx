"use client";

import { type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Server, Key, User, ArrowRight, CheckCircle2 } from "@/lib/icon-theme/lucide-react";

export function StudioUrlStep({
  studioUrl,
  onStudioUrlChange,
  onSubmit,
}: {
  studioUrl: string;
  onStudioUrlChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <>
      <div className="space-y-2 text-center">
        <Server className="w-8 h-8 text-primary mx-auto" />
        <h2 className="text-sm font-semibold">Connect to Studio</h2>
        <p className="text-sm text-muted-foreground">
          Enter the URL of your rexadb-studio backend
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Studio URL</Label>
          <Input
            placeholder="http://localhost:3000"
            value={studioUrl}
            onChange={(e) => onStudioUrlChange(e.target.value)}
            className="bg-background/70 border-border/60 h-10"
          />
        </div>
        <Button type="submit" className="w-full">
          Continue <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </form>
    </>
  );
}

export function AcceptInviteFields({
  token,
  onTokenChange,
  name,
  onNameChange,
  email,
  onEmailChange,
  loading,
  onSubmit,
}: {
  token: string;
  onTokenChange: (v: string) => void;
  name: string;
  onNameChange: (v: string) => void;
  email: string;
  onEmailChange: (v: string) => void;
  loading: boolean;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <>
      <div className="space-y-2 text-center">
        <Key className="w-8 h-8 text-primary mx-auto" />
        <h2 className="text-sm font-semibold">Accept Invite</h2>
        <p className="text-sm text-muted-foreground">Enter the invite token you received</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Invite Token</Label>
          <Input
            placeholder="64-character hex token"
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            className="bg-background/70 border-border/60 h-10 font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            <User className="w-3 h-3 inline mr-1" />
            Name
          </Label>
          <Input
            placeholder="John Doe"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="bg-background/70 border-border/60 h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            <User className="w-3 h-3 inline mr-1" />
            Email
          </Label>
          <Input
            placeholder="john@example.com"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="bg-background/70 border-border/60 h-10"
          />
        </div>
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Connecting..." : "Accept Invite & Connect"}
        </Button>
      </form>
    </>
  );
}

export function ConnectedDoneScreen({
  onDone,
}: {
  onDone: () => void;
}) {
  return (
    <>
      <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
      <h2 className="text-sm font-semibold">Connected!</h2>
      <p className="text-sm text-muted-foreground">
        You are now connected to the studio backend.
      </p>
      <Button onClick={onDone} className="w-full">
        Go to Dashboard
      </Button>
    </>
  );
}
