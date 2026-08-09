"use client";

import { useState, useRef, type ChangeEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Upload, Trash2, Loader2, KeyRound } from "@/lib/icon-theme/lucide-react";
import { studioApi } from "@/lib/studio-backend/api-client";
import { getStudioUrl } from "@/lib/studio-backend/auth-store";
import { toast } from "sonner";

interface ProfileUser {
  id: string;
  email: string;
  name: string;
  role: {
    id: number;
    name: string;
    description?: string;
  };
  avatarUrl?: string | null;
}

export function ProfileTab({
  user,
  onUserUpdate,
}: {
  user: ProfileUser;
  onUserUpdate: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const avatarSrc = user.avatarUrl
    ? `${getStudioUrl()}/api/avatars/${user.avatarUrl}`
    : null;

  const mimeFromExt = (name: string): string => {
    const ext = name.split(".").pop()?.toLowerCase();
    const map: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
    };
    return map[ext || ""] || "";
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const mime = file.type || mimeFromExt(file.name);
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/avif",
    ];
    if (!allowed.includes(mime)) {
      toast.error("Only JPEG, PNG, GIF, WebP, and AVIF images are allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      await studioApi.putBinary(`/users/${user.id}/avatar`, buffer, mime);
      toast.success("Avatar updated");
      onUserUpdate();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload avatar",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePassword = async () => {
    if (!newPassword) {
      toast.error("New password is required");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setSavingPassword(true);
    try {
      const body: Record<string, string> = { newPassword };
      if (currentPassword) body.currentPassword = currentPassword;
      await studioApi.post("/auth/password", body);
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update password",
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRemove = async () => {
    try {
      await studioApi.del(`/users/${user.id}/avatar`);
      toast.success("Avatar removed");
      onUserUpdate();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove avatar",
      );
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-sm font-semibold">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and manage your profile
        </p>
      </div>

      <Card className="border-studio-border bg-studio-bg/50 p-6 space-y-6">
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={user.name}
                className="w-20 h-20 rounded-lg object-cover border-2 border-border/60"
              />
            ) : (
              <div className="w-20 h-20 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-bold border-2 border-border/60">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 rounded-lg bg-background/60 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}
          </div>

          <div className="space-y-1 min-w-0">
            <h2 className="text-sm font-semibold truncate">{user.name}</h2>
            <p className="text-sm text-muted-foreground truncate">
              {user.email}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="w-3 h-3" />
              <span className="capitalize">{user.role.name}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-1.5" />
                Upload Photo
              </>
            )}
          </Button>
          {user.avatarUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRemove}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              Remove Photo
            </Button>
          )}
        </div>
      </Card>

      <Card className="border-studio-border bg-studio-bg/50 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Password</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Set or change your password. Leave the current password blank if you
          haven&apos;t set one yet.
        </p>

        <div className="space-y-4 max-w-sm">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              placeholder="Leave blank if none set"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="At least 6 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <Button
            onClick={handlePassword}
            disabled={savingPassword || !newPassword}
          >
            {savingPassword ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Password"
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
