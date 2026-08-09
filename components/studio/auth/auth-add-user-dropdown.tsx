"use client";

import { useState } from "react";
import { ChevronDown, Mail, UserPlus } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InviteUserModal } from "./invite-user-modal";
import { CreateUserModal } from "./create-user-modal";

interface AuthAddUserDropdownProps {
  connectionString: string;
  onUsersChanged: () => Promise<void>;
}

export function AuthAddUserDropdown({
  connectionString,
  onUsersChanged,
}: AuthAddUserDropdownProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="default" size="sm">
            Add user
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setInviteOpen(true)} className="gap-2">
            <Mail className="h-4 w-4" />
            Send invitation
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Create new user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <InviteUserModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        connectionString={connectionString}
        onInvited={onUsersChanged}
      />
      <CreateUserModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        connectionString={connectionString}
        onCreated={onUsersChanged}
      />
    </>
  );
}
