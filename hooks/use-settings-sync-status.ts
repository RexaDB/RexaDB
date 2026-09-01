"use client";

import { useEffect, useState } from "react";

import {
  getLastSettingsSyncStatus,
  requestSettingsSyncNow,
  subscribeSettingsSyncStatus,
  type SettingsSyncStatus,
  type SettingsSyncStatusDetail,
} from "@/lib/studio/settings-sync-events";

/**
 * Read-only view of the background SettingsSyncProvider status.
 * Use this in UI — do not mount a second useSettingsSync engine.
 */
export function useSettingsSyncStatus() {
  const [detail, setDetail] = useState<SettingsSyncStatusDetail>(() =>
    getLastSettingsSyncStatus(),
  );

  useEffect(() => {
    setDetail(getLastSettingsSyncStatus());
    return subscribeSettingsSyncStatus((next) => {
      setDetail(next);
    });
  }, []);

  return {
    status: detail.status as SettingsSyncStatus,
    lastSyncedAt: detail.lastSyncedAt,
    error: detail.error,
    enabled: detail.enabled,
    syncNow: requestSettingsSyncNow,
  };
}
