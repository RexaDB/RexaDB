import { UserPlus } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";

export function NeonAuthUsersHeader() {
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
        disabled
        title="User creation is not available through the Neon database connection."
        className="shrink-0 gap-2"
      >
        <UserPlus className="size-3.5" />
        Add user
      </Button>
    </div>
  );
}
