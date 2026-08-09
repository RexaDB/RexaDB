"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "rexa-db-v128-onboarding-dismissed";

export function V128OnboardingModal({
  onEnableLayout,
}: {
  onEnableLayout: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    setOpen(true);
  }, []);

  function handleDismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setOpen(false);
  }

  function handleEnable() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setOpen(false);
    onEnableLayout();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Layout Available</DialogTitle>
          <DialogDescription>
            RexaDB 1.2.8 includes a redesigned interface with a modern sidebar,
            tab bar, and streamlined navigation. Enable the new layout to try it
            out — you can always switch back in Settings.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleDismiss}>
            Maybe Later
          </Button>
          <Button onClick={handleEnable}>
            Enable New Layout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
