"use client";

import { useState } from "react";
import { toast } from "sonner";
import { runQuery } from "@/lib/api/actions-client";
import { buildInviteUserSql } from "./auth-user-sql";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InviteUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionString: string;
  onInvited: () => Promise<void>;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteUserModal({
  open,
  onOpenChange,
  connectionString,
  onInvited,
}: InviteUserModalProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter a valid email");
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setError("Please enter a valid email");
      return;
    }
    setInviting(true);
    setError(null);
    const res = await runQuery(connectionString, buildInviteUserSql(trimmed));
    setInviting(false);
    if (!res.success) {
      setError(res.error || "Failed to invite user");
      toast.error(`Failed to invite user: ${res.error || "unknown error"}`);
      return;
    }
    toast.success(`Created unconfirmed user for ${trimmed}`);
    setEmail("");
    await onInvited();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Invite a new user</DialogTitle>
          <DialogDescription>
            Create an unconfirmed user for an email address. Sending invitation emails requires the
            Supabase Auth admin API (service role key), which is not available over a database
            connection.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="invite-email">User email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleInvite();
              }}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleInvite()} disabled={inviting}>
            {inviting ? "Inviting..." : "Invite user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
