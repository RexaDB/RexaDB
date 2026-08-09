import { levelToActions, type KVPermission, type GranteeType } from "@/lib/studio/types";
import { updateEntryPermissions } from "@/lib/supabase/workspace";

export interface ShareableItem {
  id: string;
  name: string;
}

export interface ShareCallbacksConfig<T extends ShareableItem> {
  item: T;
  shareEntry: (entry: any, granteeType?: GranteeType, permissions?: KVPermission[]) => Promise<{ entryId: string | null; error: string | null }>;
  buildEntryPayload: (item: T) => any;
  onUpdateItem: (id: string, updates: { isShared: boolean; sharedEntryId?: string }) => void;
  setItem: React.Dispatch<React.SetStateAction<T | null>>;
  onToggleShare?: (id: string, share: boolean, granteeType?: "studio" | "public") => void;
  onUpdatePermissions?: (entryId: string, permissions: KVPermission[]) => Promise<void>;
}

export function useShareCallbacks<T extends ShareableItem>(config: ShareCallbacksConfig<T>) {
  const { item, shareEntry, buildEntryPayload, onUpdateItem, setItem, onToggleShare, onUpdatePermissions: onUpdatePermissionsProp } = config;

  const onShare = async (
    granteeType: GranteeType,
    permissionLevel: "view" | "edit" | "manage" | "full",
  ): Promise<string | null> => {
    const actions = levelToActions(permissionLevel);
    const perms = actions.map((a) => ({
      action: a,
      granteeType,
      granteeId: null,
    }));
    const { entryId, error } = await shareEntry(
      buildEntryPayload(item),
      granteeType,
      perms as KVPermission[],
    );
    if (entryId) {
      setItem((prev) =>
        prev ? { ...prev, isShared: true, sharedEntryId: entryId } : null,
      );
      onUpdateItem(item.id, { isShared: true, sharedEntryId: entryId });
    }
    if (error) console.error("Share failed:", error);
    return entryId ?? null;
  };

  const onUpdatePermissions = async (entryId: string, permissions: KVPermission[]) => {
    if (onUpdatePermissionsProp) {
      await onUpdatePermissionsProp(entryId, permissions);
    } else {
      await updateEntryPermissions(entryId, permissions);
    }
  };

  const onUnshare = async () => {
    if (onToggleShare) {
      onToggleShare(item.id, false);
    }
    setItem(null);
  };

  return { onShare, onUpdatePermissions, onUnshare };
}
