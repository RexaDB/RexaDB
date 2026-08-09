"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, CheckCircle2, ArrowRight } from "@/lib/icon-theme/lucide-react";
import { studioApi } from "@/lib/studio-backend/api-client";
import { toast } from "sonner";

interface RequestQueryApprovalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  connectionName: string;
  sql: string;
  teamOptions?: { id: number; name: string }[];
}

type SubmitState = "form" | "success";

export function RequestQueryApprovalDialog({
  isOpen,
  onClose,
  connectionId,
  connectionName,
  sql,
  teamOptions,
}: RequestQueryApprovalDialogProps) {
  const [teamId, setTeamId] = useState<string>(
    teamOptions?.length === 1 ? String(teamOptions[0].id) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("form");
  const [submittedId, setSubmittedId] = useState<number | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { sql };
      if (teamId) body.teamId = Number(teamId);

      const res = await studioApi.post<{ data: { id: number } }>(
        `/connections/${connectionId}/pending-queries`,
        body,
      );
      setSubmittedId(res.data.id);
      setSubmitState("success");
      toast.success("Query submitted for approval");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to submit query",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitState === "success") {
      onClose();
      setSubmitState("form");
      setSubmittedId(null);
      setTeamId(teamOptions?.length === 1 ? String(teamOptions[0].id) : "");
    } else {
      onClose();
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent className="z-[90] sm:max-w-[480px]">
        {submitState === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>Request Query Approval</DialogTitle>
              <DialogDescription>
                This connection has <Badge variant="outline" className="text-[10px] mx-1 px-1 py-0">Read & Request</Badge> access. Write queries require approval before execution.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Connection</Label>
                <p className="text-sm font-medium mt-0.5">{connectionName}</p>
              </div>

              {teamOptions && teamOptions.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Submit to team (optional)
                  </Label>
                  <Select value={teamId} onValueChange={setTeamId} disabled={submitting}>
                    <SelectTrigger className="bg-background/70 border-border/60 h-9 text-xs">
                      <SelectValue placeholder="Any approver" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any approver</SelectItem>
                      {teamOptions.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Route to a specific team&apos;s approval queue
                  </p>
                </div>
              )}

              <div>
                <Label className="text-xs text-muted-foreground">Query</Label>
                <div className="mt-1 rounded-md bg-studio-bg/50 border border-studio-border p-3 font-mono text-xs max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {sql}
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button onClick={handleClose} variant="ghost" disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                    Submit for Approval
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                <CheckCircle2 className="w-4 h-4 text-green-500 inline mr-2" />
                Query Submitted
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Your query has been submitted for review (ID: {submittedId}). An
                approver will review and execute it shortly.
              </p>
              <div className="rounded-md bg-studio-bg/50 border border-studio-border p-3 font-mono text-xs max-h-24 overflow-y-auto whitespace-pre-wrap">
                {sql}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleClose} variant="ghost">
                Close
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  setSubmitState("form");
                  setSubmittedId(null);
                  setTeamId(teamOptions?.length === 1 ? String(teamOptions[0].id) : "");
                  window.location.href = "/team";
                }}
              >
                <ArrowRight className="w-3.5 h-3.5 mr-1.5" />
                Go to Team Page
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
