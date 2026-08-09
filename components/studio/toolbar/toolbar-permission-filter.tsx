import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Shield, User, Users } from "@/lib/icon-theme/lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select";
import {
  DEFAULT_TABLE_PERMISSION_OPTION_VALUE,
  createRolePermissionContext,
  createSupabaseUserPermissionContext,
  getTablePermissionContextKey,
  type SupabaseAuthUserOption,
  type TablePermissionContext,
} from "@/lib/studio/table-permissions";

interface ToolbarPermissionFilterProps {
  value: TablePermissionContext;
  onValueChange: (value: TablePermissionContext) => void;
  postgresRoles: string[];
  supabaseAuthUsers: SupabaseAuthUserOption[];
  loading?: boolean;
}

export function ToolbarPermissionFilter({
  value,
  onValueChange,
  postgresRoles,
  supabaseAuthUsers,
  loading = false,
}: ToolbarPermissionFilterProps) {
  const [open, setOpen] = useState(false);
  const selectedValue = getTablePermissionContextKey(value);
  const triggerLabel = value ? `As ${value.label}` : "Default access";
  const uniqueRoles = Array.from(
    new Set(
      postgresRoles
        .map((role) => String(role || "").trim())
        .filter(Boolean),
    ),
  );

  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={selectedValue}
      onValueChange={(nextValue) => {
        if (nextValue === DEFAULT_TABLE_PERMISSION_OPTION_VALUE) {
          onValueChange(null);
          return;
        }

        if (nextValue.startsWith("role:")) {
          onValueChange(createRolePermissionContext(nextValue.slice(5)));
          return;
        }

        if (!nextValue.startsWith("user:")) return;
        const nextUser = supabaseAuthUsers.find((user) => `user:${user.id}` === nextValue);
        if (!nextUser) return;
        onValueChange(createSupabaseUserPermissionContext(nextUser));
      }}
    >
      <SelectTrigger className="h-8 max-w-[240px] gap-2 !border-0 !bg-transparent px-2 text-xs font-normal !shadow-none hover:!bg-transparent focus-visible:ring-0 dark:!bg-transparent dark:hover:!bg-transparent data-[state=open]:!bg-transparent dark:data-[state=open]:!bg-transparent [&>svg:last-child]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {value?.kind === "supabase-user" ? (
            <User className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Shield className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate">{triggerLabel}</span>
        </div>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </SelectTrigger>
      <SelectContent
        align="end"
        className="w-[320px]"
        searchThreshold={6}
        searchPlaceholder="Search roles or users..."
        emptyText="No permission targets found."
      >
        <SelectGroup>
          <SelectLabel className="text-xs tracking-wider text-muted-foreground/70">
            Permission Preview
          </SelectLabel>
          <SelectItem value={DEFAULT_TABLE_PERMISSION_OPTION_VALUE} className="text-xs py-2">
            <span className="flex flex-col items-start">
              <span>Default access</span>
              <span className="text-xs text-muted-foreground">Use the connection role with no impersonation.</span>
            </span>
          </SelectItem>
        </SelectGroup>

        {uniqueRoles.length > 0 ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="text-xs tracking-wider text-muted-foreground/70">
                Postgres Roles
              </SelectLabel>
              {uniqueRoles.map((role) => (
                <SelectItem key={role} value={`role:${role}`} className="text-xs py-2">
                  <span className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground/70" />
                    <span>{role}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        ) : null}

        {loading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading Supabase auth users...
          </div>
        ) : null}

        {supabaseAuthUsers.length > 0 ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="text-xs tracking-wider text-muted-foreground/70">
                Supabase Auth Users
              </SelectLabel>
              {supabaseAuthUsers.map((user) => {
                const primaryLabel = user.email || user.phone || user.displayName || user.id;
                const secondaryLabel = user.displayName && user.displayName !== primaryLabel
                  ? `${user.role || "authenticated"} • ${user.displayName}`
                  : (user.role || "authenticated");

                return (
                  <SelectItem key={user.id} value={`user:${user.id}`} className="text-xs py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-muted-foreground/70" />
                      <span className="flex min-w-0 flex-col items-start">
                        <span className="truncate max-w-[220px]">{primaryLabel}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                          {secondaryLabel}
                        </span>
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </>
        ) : null}

        <div className="border-t border-studio-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Preview mode applies the selected role or Supabase JWT claims to table reads only.
        </div>
      </SelectContent>
    </Select>
  );
}
