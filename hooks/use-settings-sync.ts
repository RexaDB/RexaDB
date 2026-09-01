"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  applySettingsSyncPayloadLocally,
  collectLocalSettingsSyncPayload,
} from "@/lib/studio/settings-sync-collect";
import {
  emitSettingsSyncApplied,
  emitSettingsSyncStatus,
  subscribeSettingsSyncLocalChanged,
  subscribeSettingsSyncRequest,
  type SettingsSyncStatus,
  type SettingsSyncStatusDetail,
} from "@/lib/studio/settings-sync-events";
import {
  bumpSettingsSyncClientUpdatedAt,
  fetchUserSettingsSync,
  parseClientUpdatedAt,
  readSettingsSyncMeta,
  saveUserSettingsSync,
  writeSettingsSyncMeta,
} from "@/lib/supabase/settings-sync";

const PUSH_DEBOUNCE_MS = 1200;
const SUPPRESS_LOCAL_MS = 2500;

type UseSettingsSyncOptions = {
  enabled: boolean;
  userId: string | null;
};

function publishStatus(detail: SettingsSyncStatusDetail) {
  emitSettingsSyncStatus(detail);
}

export function useSettingsSync({ enabled, userId }: UseSettingsSyncOptions) {
  const [status, setStatus] = useState<SettingsSyncStatus>(
    enabled ? "idle" : "disabled",
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabledRef = useRef(enabled);
  const userIdRef = useRef(userId);
  const suppressUntilRef = useRef(0);
  const pushTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const bootstrappedForUserRef = useRef<string | null>(null);
  // Ignore local save storms from hooks hydrating until the first pull finishes,
  // otherwise a fresh device can stamp clientUpdatedAt=now and overwrite cloud.
  const readyForPushRef = useRef(false);
  const lastSyncedAtRef = useRef<number | null>(null);
  const errorRef = useRef<string | null>(null);

  enabledRef.current = enabled;
  userIdRef.current = userId;

  const updateStatus = useCallback(
    (next: SettingsSyncStatus, opts?: { error?: string | null; lastSyncedAt?: number | null }) => {
      const nextError =
        opts && "error" in opts ? (opts.error ?? null) : errorRef.current;
      const nextLastSyncedAt =
        opts && "lastSyncedAt" in opts
          ? (opts.lastSyncedAt ?? null)
          : lastSyncedAtRef.current;

      errorRef.current = nextError;
      lastSyncedAtRef.current = nextLastSyncedAt;
      setStatus(next);
      setError(nextError);
      setLastSyncedAt(nextLastSyncedAt);
      publishStatus({
        status: next,
        lastSyncedAt: nextLastSyncedAt,
        error: nextError,
        enabled: enabledRef.current,
      });
    },
    [],
  );

  const applyRemote = useCallback(
    async (
      payload: Parameters<typeof applySettingsSyncPayloadLocally>[0],
      clientUpdatedAt: number,
      source: "pull" | "push-rejected",
    ) => {
      suppressUntilRef.current = Date.now() + SUPPRESS_LOCAL_MS;
      await applySettingsSyncPayloadLocally(payload);
      const meta = readSettingsSyncMeta();
      writeSettingsSyncMeta({
        ...meta,
        clientUpdatedAt,
        remoteClientUpdatedAt: clientUpdatedAt,
        lastPulledAt: Date.now(),
      });
      emitSettingsSyncApplied({ payload, clientUpdatedAt, source });
    },
    [],
  );

  const pushLocal = useCallback(async () => {
    if (!enabledRef.current || !userIdRef.current) return;
    if (Date.now() < suppressUntilRef.current) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    updateStatus("syncing", { error: null });

    try {
      const meta = readSettingsSyncMeta();
      const clientUpdatedAt =
        meta.clientUpdatedAt > 0 ? meta.clientUpdatedAt : Date.now();
      if (meta.clientUpdatedAt <= 0) {
        bumpSettingsSyncClientUpdatedAt(clientUpdatedAt);
      }

      const payload = await collectLocalSettingsSyncPayload();
      const { result, error: saveError } = await saveUserSettingsSync({
        payload,
        clientUpdatedAt,
      });

      if (saveError || !result) {
        updateStatus("error", { error: saveError || "Failed to sync settings." });
        return;
      }

      const remoteUpdatedAt = parseClientUpdatedAt(result.client_updated_at);

      if (!result.applied) {
        await applyRemote(result.payload, remoteUpdatedAt, "push-rejected");
        updateStatus("synced", {
          error: null,
          lastSyncedAt: Date.now(),
        });
        return;
      }

      const nextMeta = readSettingsSyncMeta();
      writeSettingsSyncMeta({
        ...nextMeta,
        clientUpdatedAt: remoteUpdatedAt || clientUpdatedAt,
        remoteClientUpdatedAt: remoteUpdatedAt || clientUpdatedAt,
        lastPushedAt: Date.now(),
      });
      updateStatus("synced", { error: null, lastSyncedAt: Date.now() });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to sync settings.";
      updateStatus("error", { error: message });
    } finally {
      inFlightRef.current = false;
    }
  }, [applyRemote, updateStatus]);

  const pullAndReconcile = useCallback(async () => {
    if (!enabledRef.current || !userIdRef.current) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    updateStatus("syncing", { error: null });

    try {
      const { row, error: fetchError } = await fetchUserSettingsSync();
      if (fetchError) {
        updateStatus("error", { error: fetchError });
        return;
      }

      const meta = readSettingsSyncMeta();
      const localUpdatedAt = meta.clientUpdatedAt;

      if (!row) {
        // First device / empty cloud — seed remote from local.
        inFlightRef.current = false;
        if (localUpdatedAt <= 0) {
          bumpSettingsSyncClientUpdatedAt(Date.now());
        }
        await pushLocal();
        return;
      }

      const remoteUpdatedAt = parseClientUpdatedAt(row.client_updated_at);

      if (remoteUpdatedAt > localUpdatedAt) {
        await applyRemote(row.payload, remoteUpdatedAt, "pull");
        updateStatus("synced", { error: null, lastSyncedAt: Date.now() });
        return;
      }

      if (localUpdatedAt > remoteUpdatedAt) {
        inFlightRef.current = false;
        await pushLocal();
        return;
      }

      writeSettingsSyncMeta({
        ...meta,
        remoteClientUpdatedAt: remoteUpdatedAt,
        lastPulledAt: Date.now(),
      });
      updateStatus("synced", { error: null, lastSyncedAt: Date.now() });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to sync settings.";
      updateStatus("error", { error: message });
    } finally {
      inFlightRef.current = false;
    }
  }, [applyRemote, pushLocal, updateStatus]);

  const schedulePush = useCallback(() => {
    if (!enabledRef.current || !userIdRef.current) return;
    if (!readyForPushRef.current) return;
    if (Date.now() < suppressUntilRef.current) return;

    bumpSettingsSyncClientUpdatedAt(Date.now());

    if (pushTimerRef.current !== null) {
      window.clearTimeout(pushTimerRef.current);
    }
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null;
      void pushLocal();
    }, PUSH_DEBOUNCE_MS);
  }, [pushLocal]);

  const syncNow = useCallback(() => {
    return pullAndReconcile();
  }, [pullAndReconcile]);

  useEffect(() => {
    if (!enabled || !userId) {
      bootstrappedForUserRef.current = null;
      readyForPushRef.current = false;
      updateStatus("disabled", { error: null });
      return;
    }

    if (bootstrappedForUserRef.current === userId) return;
    bootstrappedForUserRef.current = userId;
    readyForPushRef.current = false;
    void pullAndReconcile().finally(() => {
      readyForPushRef.current = true;
    });
  }, [enabled, pullAndReconcile, updateStatus, userId]);

  useEffect(() => {
    return subscribeSettingsSyncLocalChanged(() => {
      schedulePush();
    });
  }, [schedulePush]);

  useEffect(() => {
    return subscribeSettingsSyncRequest(() => {
      void pullAndReconcile();
    });
  }, [pullAndReconcile]);

  useEffect(() => {
    return () => {
      if (pushTimerRef.current !== null) {
        window.clearTimeout(pushTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onFocus = () => {
      if (!enabledRef.current || !userIdRef.current) return;
      void pullAndReconcile();
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pullAndReconcile]);

  return {
    status,
    lastSyncedAt,
    error,
    enabled,
    syncNow,
  };
}
