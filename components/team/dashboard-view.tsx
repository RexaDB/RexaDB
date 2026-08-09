"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Database, Shield, Activity, Server } from "@/lib/icon-theme/lucide-react";
import { studioApi, StudioApiError } from "@/lib/studio-backend/api-client";
import { clearAllStudioData } from "@/lib/studio-backend/auth-store";
import type { ApiResponse, Role, Connection } from "@/lib/studio-backend/types";

interface DashboardStats {
  userCount: number;
  roleCount: number;
  connectionCount: number;
}

export function DashboardView() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentConnections, setRecentConnections] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [rolesRes, connsRes] = await Promise.all([
          studioApi.get<ApiResponse<Role[]>>("/roles"),
          studioApi.get<ApiResponse<Connection[]>>("/connections"),
        ]);
        const roles = rolesRes.data || [];
        const conns = connsRes.data || [];
        setStats({
          userCount: roles.reduce((sum, r) => sum + (r.userCount || 0), 0),
          roleCount: roles.length,
          connectionCount: conns.length,
        });
        setRecentConnections(conns.slice(0, 5));
      } catch (err) {
        if (err instanceof StudioApiError && err.status === 401) {
          clearAllStudioData();
          window.location.href = "/team/accept-invite";
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-lg border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Card className="p-6 border-destructive/30 text-center space-y-2">
          <Server className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      </div>
    );
  }

  const statCards = [
    {
      label: "Users",
      value: stats?.userCount ?? 0,
      icon: Users,
      color: "text-blue-500",
    },
    {
      label: "Roles",
      value: stats?.roleCount ?? 0,
      icon: Shield,
      color: "text-purple-500",
    },
    {
      label: "Connections",
      value: stats?.connectionCount ?? 0,
      icon: Database,
      color: "text-emerald-500",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-sm font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your studio backend
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {statCards.map((card) => (
          <Card
            key={card.label}
            className="p-5 border-studio-border bg-studio-bg/50"
          >
            <div className="flex items-center gap-3">
              <div className={`${card.color}`}>
                <card.icon className="w-8 h-8" />
              </div>
              <div>
                <p className="text-sm font-bold">{card.value}</p>
                <p className="text-xs text-muted-foreground">{card.label}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="border-studio-border bg-studio-bg/50">
        <div className="p-4 border-b border-studio-border">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            Recent Connections
          </h2>
        </div>
        <div className="divide-y divide-studio-border">
          {recentConnections.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">
              No connections yet
            </p>
          ) : (
            recentConnections.map((conn) => (
              <div
                key={conn.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Database className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">{conn.name}</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {conn.type}
                </Badge>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
