"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { LayoutDashboard, Shield, Users, Database, Mail, ClipboardCheck } from "@/lib/icon-theme/lucide-react";
import { DashboardView } from "./dashboard-view";
import { RoleList } from "./role-list";
import { UserList } from "./user-list";
import { ConnectionList } from "./connection-list";
import { InviteList } from "./invite-list";
import { PendingQueryList } from "./pending-query-list";
import { useStudioAuth } from "./studio-auth-provider";

const tabs = [
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "roles", label: "Roles", icon: Shield },
  { value: "users", label: "Users", icon: Users },
  { value: "connections", label: "Connections", icon: Database },
  { value: "pending", label: "Pending", icon: ClipboardCheck },
  { value: "invites", label: "Invites", icon: Mail },
] as const;

export function TeamTabs() {
  const { auth } = useStudioAuth();
  const [pendingCount, setPendingCount] = useState(0);

  return (
    <Tabs defaultValue="dashboard" className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 pt-3 pb-0 border-b border-studio-border shrink-0">
        <TabsList className="bg-transparent p-0 h-auto gap-1">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-1.5 px-3 py-2 text-sm data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground data-[state=inactive]:text-muted-foreground rounded-none border-b-2 border-transparent data-[state=active]:border-primary transition-colors"
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.value === "pending" && pendingCount > 0 && (
                <Badge className="ml-1 h-4 px-1 text-[10px] min-w-[1rem] bg-amber-500/15 text-amber-600 border-amber-500/30 hover:bg-amber-500/15">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <TabsContent
            key={tab.value}
            value={tab.value}
            className="mt-0 h-full data-[state=active]:flex flex-col"
          >
            {tab.value === "dashboard" && <DashboardView />}
            {tab.value === "roles" && <RoleList />}
            {tab.value === "users" && <UserList />}
            {tab.value === "connections" && <ConnectionList />}
            {tab.value === "pending" && (
              <PendingQueryList
                userId={auth?.userId}
                onCountChange={setPendingCount}
              />
            )}
            {tab.value === "invites" && <InviteList />}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
