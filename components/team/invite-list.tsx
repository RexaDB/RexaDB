"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail } from "@/lib/icon-theme/lucide-react";
import { UserPopover } from "@/components/team/user-popover";
import { getStudioUrl } from "@/lib/studio-backend/auth-store";
import type { Invite } from "@/lib/studio-backend/types";
import { fetchTeamList } from "@/components/shared/team-list-utils";

export function InviteList() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    await fetchTeamList(
      "/invites",
      setInvites,
      setLoading,
      "Failed to load invites",
    );
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "PENDING":
        return (
          <Badge
            variant="outline"
            className="text-amber-500 border-amber-500/30"
          >
            Pending
          </Badge>
        );
      case "ACCEPTED":
        return (
          <Badge variant="secondary" className="text-emerald-500">
            Accepted
          </Badge>
        );
      case "EXPIRED":
        return (
          <Badge variant="outline" className="text-muted-foreground">
            Expired
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-lg border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-sm font-semibold">Invites</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track invitation statuses
        </p>
      </div>

      <Card className="border-studio-border bg-studio-bg/50">
        <div className="divide-y divide-studio-border">
          {invites.length === 0 ? (
            <div className="p-8 text-center">
              <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No invites yet</p>
            </div>
          ) : (
            invites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{invite.email}</span>
                    {getStatusBadge(invite.status)}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <span>Created by </span>
                    <UserPopover user={invite.createdBy}>
                      {invite.createdBy?.avatarUrl ? (
                        <img
                          src={`${getStudioUrl()}/api/avatars/${invite.createdBy.avatarUrl}`}
                          alt=""
                          className="w-4 h-4 rounded-lg object-cover inline-block"
                        />
                      ) : invite.createdBy?.name ? (
                        <span className="w-4 h-4 rounded-lg bg-primary/10 text-primary inline-flex items-center justify-center text-xs font-bold shrink-0">
                          {invite.createdBy.name.charAt(0).toUpperCase()}
                        </span>
                      ) : null}
                      <span>
                        {invite.createdBy?.name ||
                          invite.createdBy?.email ||
                          "Unknown"}
                      </span>
                    </UserPopover>
                    <span>{" • "}</span>
                    <span>
                      Expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </span>
                    {invite.acceptedAt && (
                      <span>
                        {" • "}Accepted{" "}
                        {new Date(invite.acceptedAt).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
