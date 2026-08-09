"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Lock, Mail } from "@/lib/icon-theme/lucide-react";
import { runQuery } from "@/lib/api/actions-client";
import { buildCreateUserSql } from "./auth-user-sql";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreateUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionString: string;
  onCreated: () => Promise<void>;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CreateUserModal({
  open,
  onOpenChange,
  connectionString,
  onCreated,
}: CreateUserModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [autoConfirmUser, setAutoConfirmUser] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const trimmedEmail = email.trim();
    const nextErrors: { email?: string; password?: string } = {};
    if (!trimmedEmail) nextErrors.email = "Email is required";
    else if (!EMAIL_REGEX.test(trimmedEmail)) nextErrors.email = "Must be a valid email address";
    if (!password) nextErrors.password = "Password is required";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setCreating(true);
    const res = await runQuery(
      connectionString,
      buildCreateUserSql(trimmedEmail, password, autoConfirmUser),
    );
    setCreating(false);
    if (!res.success) {
      toast.error(`Failed to create user: ${res.error || "unknown error"}`);
      return;
    }
    toast.success(`Successfully created user: ${trimmedEmail}`);
    setEmail("");
    setPassword("");
    setAutoConfirmUser(true);
    await onCreated();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Create a new user</DialogTitle>
          <DialogDescription>
            Create a user directly in the auth.users table. A confirmation email will not be sent
            when creating a user via this form.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="create-email">Email address</Label>
            <div className="relative">
              <Mail
                size={18}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.5}
              />
              <Input
                id="create-email"
                type="email"
                autoComplete="off"
                placeholder="user@example.com"
                className="pl-8"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
            {errors.email ? <p className="text-sm text-destructive">{errors.email}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-password">User Password</Label>
            <div className="relative">
              <Lock
                size={18}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.5}
              />
              <Input
                id="create-password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                className="pl-8"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {errors.password ? <p className="text-sm text-destructive">{errors.password}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="create-auto-confirm"
              checked={autoConfirmUser}
              onCheckedChange={(value) => setAutoConfirmUser(value === true)}
            />
            <Label htmlFor="create-auto-confirm">Auto confirm user?</Label>
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
