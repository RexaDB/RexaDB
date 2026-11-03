"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail, User } from "@/lib/icon-theme/lucide-react";
import { createAuthUser } from "@/lib/neon-cli/client";
import type { NeonCliPointer } from "@/lib/neon-cli/pointer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NeonCreateUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pointer: NeonCliPointer;
  onCreated: () => Promise<void>;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NeonCreateUserModal({
  open,
  onOpenChange,
  pointer,
  onCreated,
}: NeonCreateUserModalProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return setError("Email is required");
    if (!EMAIL_REGEX.test(trimmedEmail)) return setError("Must be a valid email address");
    setError(undefined);

    // POST is not idempotent on Neon's side, so a failure is surfaced rather
    // than retried — a retry after a timeout could create a duplicate user.
    setCreating(true);
    try {
      await createAuthUser(
        pointer.profile,
        pointer.projectId,
        pointer.branchId,
        trimmedEmail,
        name.trim() || undefined,
      );
    } catch (err) {
      toast.error(`Failed to create user: ${err instanceof Error ? err.message : "unknown error"}`);
      return;
    } finally {
      setCreating(false);
    }
    toast.success(`Successfully created user: ${trimmedEmail}`);
    setEmail("");
    setName("");
    await onCreated();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Create a new user</DialogTitle>
          <DialogDescription>
            Add a user to this branch&apos;s Neon Auth directory. They sign in with the
            branch&apos;s configured auth providers.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="neon-create-email">Email address</Label>
            <div className="relative">
              <Mail
                size={18}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.5}
              />
              <Input
                id="neon-create-email"
                type="email"
                autoComplete="off"
                placeholder="user@example.com"
                className="pl-8"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="neon-create-name">Name (optional)</Label>
            <div className="relative">
              <User
                size={18}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.5}
              />
              <Input
                id="neon-create-name"
                autoComplete="off"
                placeholder="Jane Doe"
                className="pl-8"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleCreate()} disabled={creating}>
            {creating ? "Creating..." : "Create user"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
