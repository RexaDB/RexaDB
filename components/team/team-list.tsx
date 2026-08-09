"use client";

import { useState, useEffect, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Users, ChevronRight } from "@/lib/icon-theme/lucide-react";
import { studioApi } from "@/lib/studio-backend/api-client";
import { getStudioUrl } from "@/lib/studio-backend/auth-store";
import type { ApiResponse } from "@/lib/studio-backend/types";
import {
  TeamListLayout,
  fetchTeamList,
} from "@/components/shared/team-list-utils";
import { UserPopover } from "@/components/team/user-popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Team {
  id: number;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

interface TeamMember {
  teamId: number;
  userId: string;
  role: "admin" | "member";
  joinedAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    role?: { id: number; name: string } | null;
  };
}

export function TeamList({ permissions }: { permissions?: Set<string> }) {
  const canCreate = !permissions || permissions.has("teams.create");
  const [teams, setTeams] = useState<Team[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [members, setMembers] = useState<Record<number, TeamMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [formName, setFormName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTeams();
  }, []);

  async function loadTeams() {
    await fetchTeamList("/teams", setTeams, setLoading, "Failed to load teams");
  }

  async function loadMembers(teamId: number) {
    if (members[teamId]) return;
    try {
      const res = await studioApi.get<ApiResponse<TeamMember[]>>(
        `/teams/${teamId}/members`,
      );
      setMembers((prev) => ({ ...prev, [teamId]: res.data || [] }));
    } catch {
      toast.error("Failed to load team members");
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    setSaving(true);
    try {
      await studioApi.post("/teams", {
        name: formName.trim(),
        description: "",
      });
      toast.success("Team created");
      setShowDialog(false);
      setFormName("");
      await loadTeams();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TeamListLayout
      loading={loading}
      title="Teams"
      description="Manage teams and their access"
      buttonLabel="Create Team"
      buttonDisabled={!canCreate}
      onButtonClick={() => setShowDialog(true)}
    >
      <div className="grid gap-3">
        {teams.length === 0 ? (
          <Card className="p-8 text-center border-studio-border">
            <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No teams yet</p>
          </Card>
        ) : (
          teams.map((team) => (
            <Card
              key={team.id}
              className="border-studio-border bg-studio-bg/50"
            >
              <button
                onClick={() => {
                  if (expanded === team.id) {
                    setExpanded(null);
                    return;
                  }
                  setExpanded(team.id);
                  loadMembers(team.id);
                }}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-studio-bg/80 transition-colors"
              >
                <div className="space-y-1">
                  <span className="font-medium">{team.name}</span>
                  {team.description && (
                    <p className="text-sm text-muted-foreground">
                      {team.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {team.memberCount} members
                    </span>
                  </div>
                </div>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    expanded === team.id && "rotate-90",
                  )}
                />
              </button>

              {expanded === team.id && (
                <div className="border-t border-studio-border divide-y divide-studio-border">
                  {(members[team.id] ?? []).length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground text-center">
                      No members
                    </p>
                  ) : (
                    (members[team.id] ?? []).map((m) => (
                      <div
                        key={m.userId}
                        className="flex items-center justify-between px-4 py-2.5"
                      >
                        <UserPopover user={m.user}>
                          <div className="flex items-center gap-2">
                            {m.user.avatarUrl ? (
                              <img
                                src={`${getStudioUrl()}/api/avatars/${m.user.avatarUrl}`}
                                alt=""
                                className="w-5 h-5 rounded-lg object-cover shrink-0"
                              />
                            ) : (
                              <div className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                {m.user.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="text-sm">{m.user.name}</span>
                            <span className="text-xs text-muted-foreground">
                              ({m.user.email})
                            </span>
                          </div>
                        </UserPopover>
                        <Badge variant="outline" className="text-xs capitalize">
                          {m.role}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card>
          ))
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Team</DialogTitle>
            <DialogDescription>Enter a name for the new team</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-3 py-3">
              <Label className="text-xs text-muted-foreground">Team Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="My Team"
                className="bg-background/70 border-border/60"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDialog(false)}
                size="sm"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || !formName.trim()}
                size="sm"
              >
                {saving ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </TeamListLayout>
  );
}
