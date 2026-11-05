import { UserPlus } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";

interface NeonAuthUsersHeaderProps {
  /** Omitted when the connection cannot create users (no Neon API token). */
  onAddUser?: () => void;
}

export function NeonAuthUsersHeader({ onAddUser }: NeonAuthUsersHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 md:px-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage users who have signed up for your Neon Auth project.
        </p>
      </div>
      <Button
        variant="default"
        size="sm"
        onClick={onAddUser}
        disabled={!onAddUser}
        title={onAddUser ? undefined : "User creation is not available through the Neon database connection."}
        className="shrink-0 gap-2"
      >
        <UserPlus className="size-3.5" />
        Add user
      </Button>
    </div>
  );
}
