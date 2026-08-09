"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { publishTheme } from "@/lib/supabase/theme-marketplace";

interface PublishThemeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  themeType: "app" | "editor";
  themeName: string;
  themeJson: Record<string, unknown>;
  onPublished: () => void;
}

export function PublishThemeDialog({
  open,
  onOpenChange,
  themeType,
  themeName,
  themeJson,
  onPublished,
}: PublishThemeDialogProps) {
  const [description, setDescription] = useState("");
  const [publishing, setPublishing] = useState(false);

  const handlePublish = async () => {
    setPublishing(true);
    const { id, error } = await publishTheme({
      name: themeName,
      description,
      themeType,
      themeJson,
    });
    setPublishing(false);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success(`Published "${themeName}" to the community!`);
    setDescription("");
    onPublished();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish Theme</DialogTitle>
          <DialogDescription>
            Share your {themeType === "app" ? "app" : "editor"} theme with the community.
            Others will be able to browse and apply it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">Theme Name</label>
            <Input value={themeName} disabled className="text-xs" />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your theme — what inspired it, what it's best for..."
              className="min-h-[100px] text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handlePublish} disabled={publishing}>
            {publishing ? "Publishing..." : "Publish to Community"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
