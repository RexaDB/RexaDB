"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Globe,
  Users,
  Copy,
  Check,
  UserPlus,
  ExternalLink,
  User,
  Building2,
  ShieldCheck,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
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
import type {
  KVPermission,
  GranteeType,
  PermissionLevel,
} from "@/lib/studio/types";
import {
  PERMISSION_LEVELS,
  actionsToLevel,
  levelToActions,
} from "@/lib/studio/types";
import {
  getEntryPermissions,
  getWorkspaceMembers,
} from "@/lib/supabase/workspace";
import { getStudioUrl, loadStudioAuth } from "@/lib/studio-backend/auth-store";

function PermissionLevelSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: PermissionLevel;
  onChange: (level: PermissionLevel) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PermissionLevel)} disabled={disabled}>
      <SelectTrigger className={className ?? "h-7 text-xs"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERMISSION_LEVELS.map((level) => (
          <SelectItem key={level.value} value={level.value} className="text-xs">
            {level.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  itemType: "snippet" | "dashboard";
  isShared: boolean;
  sharedEntryId?: string | null;
  onShare: (
    granteeType: GranteeType,
    permissionLevel: PermissionLevel,
  ) => Promise<string | null>;
  onUpdatePermissions: (
    entryId: string,
    permissions: KVPermission[],
  ) => Promise<void>;
  onUnshare: () => Promise<void>;
  sharing: boolean;
  workspaceMembers?: Array<{ id: string; name: string; email: string }>;
}

type GeneralAccess = "restricted" | "workspace" | "public";

interface UserEntry {
  granteeId: string;
  name: string;
  email: string;
  level: PermissionLevel;
}

interface DraftState {
  generalAccess: GeneralAccess;
  workspaceLevel: PermissionLevel;
  publicLevel: PermissionLevel;
  users: UserEntry[];
}

const GENERAL_ACCESS_OPTIONS: { value: GeneralAccess; label: string }[] = [
  { value: "restricted", label: "Restricted" },
  { value: "workspace", label: "Workspace members" },
  { value: "public", label: "Anyone with the link" },
];

const GRANTEE_ICONS: Record<GranteeType, typeof User> = {
  user: User,
  role: ShieldCheck,
  team: Building2,
  studio: Users,
  public: Globe,
};

function permissionKey(p: KVPermission): string {
  return `${p.granteeType}:${p.granteeId ?? ""}:${p.action}`;
}

function permissionsEqual(a: KVPermission[], b: KVPermission[]): boolean {
  if (a.length !== b.length) return false;
  const aKeys = new Set(a.map(permissionKey));
  return b.every((p) => aKeys.has(permissionKey(p)));
}

function draftToPermissions(d: DraftState): KVPermission[] {
  const perms: KVPermission[] = [];
  if (d.generalAccess === "workspace") {
    for (const a of levelToActions(d.workspaceLevel)) {
      perms.push({ action: a, granteeType: "studio", granteeId: null });
    }
  } else if (d.generalAccess === "public") {
    for (const a of levelToActions(d.publicLevel)) {
      perms.push({ action: a, granteeType: "public", granteeId: null });
    }
  }
  for (const u of d.users) {
    for (const a of levelToActions(u.level)) {
      perms.push({ action: a, granteeType: "user", granteeId: u.granteeId });
    }
  }
  return perms;
}

export function ShareDialog({
  open,
  onOpenChange,
  itemName,
  isShared,
  sharedEntryId,
  onShare,
  onUpdatePermissions,
  onUnshare,
  sharing,
  workspaceMembers = [],
}: ShareDialogProps) {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [initialPerms, setInitialPerms] = useState<KVPermission[]>([]);
  const [members, setMembers] = useState<
    Array<{ id: string; name: string; email: string; avatarUrl: string | null }>
  >([]);
  const [personSearch, setPersonSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setMembers([]);
      return;
    }
    setSaving(true);
    const init = async () => {
      const fetchedMembers = await getWorkspaceMembers();
      setMembers(fetchedMembers);
      if (sharedEntryId) {
        const res = await getEntryPermissions(sharedEntryId);
        const perms = res.permissions;
        const userPerms = perms.filter((p) => p.granteeType === "user");
        const seen = new Set<string>();
        const users: UserEntry[] = [];
        for (const p of userPerms) {
          if (!p.granteeId || seen.has(p.granteeId)) continue;
          seen.add(p.granteeId);
          const member = fetchedMembers.find((m) => m.id === p.granteeId);
          const related = userPerms.filter(
            (up) => up.granteeId === p.granteeId,
          );
          users.push({
            granteeId: p.granteeId,
            name: member?.name || p.granteeId,
            email: member?.email || "",
            level: actionsToLevel(related.map((u) => u.action)),
          });
        }
        const sp = perms.filter((p) => p.granteeType === "studio");
        const pp = perms.filter((p) => p.granteeType === "public");
        const d: DraftState = {
          generalAccess:
            sp.length > 0
              ? "workspace"
              : pp.length > 0
                ? "public"
                : "restricted",
          workspaceLevel:
            sp.length > 0 ? actionsToLevel(sp.map((p) => p.action)) : "view",
          publicLevel:
            pp.length > 0 ? actionsToLevel(pp.map((p) => p.action)) : "view",
          users,
        };
        setDraft(d);
        setInitialPerms(draftToPermissions(d));
      } else {
        const d: DraftState = {
          generalAccess: "restricted",
          workspaceLevel: "view",
          publicLevel: "view",
          users: [],
        };
        setDraft(d);
        setInitialPerms([]);
      }
      setSaving(false);
    };
    init();
    setCopied(false);
    setPersonSearch("");
  }, [open]);

  const currentPerms = useMemo(
    () => (draft ? draftToPermissions(draft) : []),
    [draft],
  );
  const hasChanges = draft && !permissionsEqual(currentPerms, initialPerms);

  const publicUrl = sharedEntryId
    ? `${getStudioUrl() || (typeof window !== "undefined" ? window.location.origin : "")}/api/kv-store/${sharedEntryId}`
    : null;

  const currentUserId = useMemo(() => loadStudioAuth()?.userId ?? null, []);
  const filteredMembers = members.filter((m) => {
    if (!personSearch) return false;
    if (m.id === currentUserId) return false;
    const q = personSearch.toLowerCase();
    return (
      (m.name?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q)) &&
      !draft?.users.some((u) => u.granteeId === m.id)
    );
  });

  const addUserToDraft = (member: {
    id: string;
    name: string;
    email: string;
  }) => {
    if (!draft) return;
    if (draft.users.some((u) => u.granteeId === member.id)) return;
    setDraft({
      ...draft,
      users: [
        ...draft.users,
        {
          granteeId: member.id,
          name: member.name,
          email: member.email,
          level: "view" as PermissionLevel,
        },
      ],
    });
    setPersonSearch("");
  };

  const changeUserLevel = (granteeId: string, level: PermissionLevel) => {
    if (!draft) return;
    setDraft({
      ...draft,
      users: draft.users.map((u) =>
        u.granteeId === granteeId ? { ...u, level } : u,
      ),
    });
  };

  const changeGeneralAccess = (val: GeneralAccess) => {
    if (!draft) return;
    setDraft({ ...draft, generalAccess: val });
  };

  const changeWorkspaceLevel = (level: PermissionLevel) => {
    if (!draft) return;
    setDraft({ ...draft, workspaceLevel: level });
  };

  const changePublicLevel = (level: PermissionLevel) => {
    if (!draft) return;
    setDraft({ ...draft, publicLevel: level });
  };

  const handleClearAll = () => {
    if (!draft) return;
    setDraft({
      generalAccess: "restricted",
      workspaceLevel: "view",
      publicLevel: "view",
      users: [],
    });
  };

  const handleDone = async () => {
    if (!draft) return;
    if (!hasChanges) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    const finalPerms = currentPerms;
    if (sharedEntryId) {
      if (finalPerms.length === 0) {
        await onUnshare();
      } else {
        await onUpdatePermissions(sharedEntryId, finalPerms);
      }
    } else {
      if (finalPerms.length > 0) {
        const entryId = await onShare("studio", "view");
        if (entryId) {
          await onUpdatePermissions(entryId, finalPerms);
        }
      }
    }
    setSaving(false);
    onOpenChange(false);
  };

  const copyPublicLink = useCallback(() => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [publicUrl]);

  const isLoading = sharing || saving;

  const granteeEntries = useMemo(() => {
    if (!draft) return [];
    const entries: Array<{
      id: string;
      granteeType: GranteeType;
      granteeId: string | null;
      label: string;
      sublabel: string;
      level: PermissionLevel;
      isOwner?: boolean;
    }> = [];

    if (currentUserId) {
      const ownerMember = members.find((m) => m.id === currentUserId);
      entries.push({
        id: "owner",
        granteeType: "user",
        granteeId: currentUserId,
        label: ownerMember?.name || "Owner",
        sublabel: ownerMember?.email || "",
        level: "full",
        isOwner: true,
      });
    }

    if (draft.generalAccess === "workspace") {
      entries.push({
        id: "studio",
        granteeType: "studio",
        granteeId: null,
        label: "Workspace members",
        sublabel: "Everyone in this workspace",
        level: draft.workspaceLevel,
      });
    } else if (draft.generalAccess === "public") {
      entries.push({
        id: "public",
        granteeType: "public",
        granteeId: null,
        label: "Anyone with the link",
        sublabel: "Public access (no login required)",
        level: draft.publicLevel,
      });
    }
    for (const u of draft.users) {
      if (u.granteeId === currentUserId) continue;
      entries.push({
        id: `user-${u.granteeId}`,
        granteeType: "user",
        granteeId: u.granteeId,
        label: u.name,
        sublabel: u.email,
        level: u.level,
      });
    }
    return entries;
  }, [draft, members, currentUserId]);

  const hasAnyAccess =
    draft && (draft.generalAccess !== "restricted" || draft.users.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-base">
            Share
            <span className="truncate text-muted-foreground font-normal text-sm">
              &ldquo;{itemName}&rdquo;
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Add people */}
          <div>
            <div className="relative">
              <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Add people by name or email..."
                className="pl-9 h-9 text-sm"
              />
            </div>
            {personSearch && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border">
                {members.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No workspace members available
                  </p>
                ) : filteredMembers.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No matching members
                  </p>
                ) : (
                  filteredMembers.map((member) => {
                    const src = member.avatarUrl
                      ? `${getStudioUrl() || (typeof window !== "undefined" ? window.location.origin : "")}/api/avatars/${member.avatarUrl}`
                      : null;
                    return (
                      <button
                        key={member.id}
                        onClick={() => addUserToDraft(member)}
                        disabled={isLoading}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                      >
                        {src ? (
                          <img
                            src={src}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-muted-foreground/20 flex items-center justify-center text-[11px] font-medium shrink-0">
                            {(member.name ||
                              member.email ||
                              "?")[0].toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">
                            {member.name || "Unknown"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {member.email}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          + Add
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* General access */}
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-foreground">
                General access
              </p>
              <Select
                value={draft?.generalAccess ?? "restricted"}
                onValueChange={(v) => changeGeneralAccess(v as GeneralAccess)}
                disabled={isLoading}
              >
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENERAL_ACCESS_OPTIONS.map((o) => (
                    <SelectItem
                      key={o.value}
                      value={o.value}
                      className="text-xs"
                    >
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {draft?.generalAccess === "workspace" && (
              <div className="flex items-center justify-between gap-4 mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">Access level</p>
                <PermissionLevelSelect value={draft.workspaceLevel} onChange={changeWorkspaceLevel} disabled={isLoading} className="w-28 h-7 text-xs" />
              </div>
            )}

            {draft?.generalAccess === "public" && (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-muted-foreground">Access level</p>
                  <PermissionLevelSelect value={draft.publicLevel} onChange={changePublicLevel} disabled={isLoading} className="w-28 h-7 text-xs" />

                </div>
                <div className="flex items-center gap-2 overflow-hidden">
                  {publicUrl ? (
                    <>
                      <span className="truncate text-xs text-muted-foreground font-mono flex-1 min-w-0">
                        {publicUrl}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={copyPublicLink}
                        className="shrink-0"
                      >
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => window.open(publicUrl, "_blank")}
                        className="shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Save to get a link
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* People with access */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">
              People with access ({granteeEntries.length})
            </p>
            {granteeEntries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center">
                <p className="text-xs text-muted-foreground">
                  No one has access yet. Adjust general access above or add
                  people by searching.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {granteeEntries.map((entry) => {
                  const Icon = GRANTEE_ICONS[entry.granteeType];
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
                    >
                      {entry.granteeType === "user" && entry.granteeId ? (
                        (() => {
                          const m = members.find(
                            (x) => x.id === entry.granteeId,
                          );
                          const src = m?.avatarUrl
                            ? `${getStudioUrl() || (typeof window !== "undefined" ? window.location.origin : "")}/api/avatars/${m.avatarUrl}`
                            : null;
                          return src ? (
                            <img
                              src={src}
                              alt=""
                              className="w-8 h-8 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-muted-foreground/15 flex items-center justify-center shrink-0">
                              <Icon className="w-4 h-4 text-muted-foreground" />
                            </div>
                          );
                        })()
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted-foreground/15 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">
                          {entry.label}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {entry.sublabel}
                        </p>
                      </div>
                      {entry.isOwner ? (
                        <span className="text-xs text-muted-foreground shrink-0 w-[5.5rem] text-right">
                          Full access
                        </span>
                      ) : entry.granteeType === "studio" ? (
                        <PermissionLevelSelect value={draft?.workspaceLevel ?? "view"} onChange={changeWorkspaceLevel} disabled={isLoading} />
                      ) : entry.granteeType === "public" ? (
                        <PermissionLevelSelect value={draft?.publicLevel ?? "view"} onChange={changePublicLevel} disabled={isLoading} />
                      ) : (
                        <PermissionLevelSelect value={entry.level} onChange={(v) => changeUserLevel(entry.granteeId!, v)} disabled={isLoading} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          {hasAnyAccess ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-destructive h-7 px-2"
              onClick={handleClearAll}
              disabled={isLoading}
            >
              Remove all sharing
            </Button>
          ) : (
            <div />
          )}
          <Button
            size="sm"
            className="h-8 text-xs px-4"
            onClick={handleDone}
            disabled={isLoading}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
