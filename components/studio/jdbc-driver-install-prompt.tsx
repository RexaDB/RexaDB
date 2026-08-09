"use client";

import { useState, useEffect, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { type JdbcDriverTemplate } from "@/lib/db/jdbc-templates";
import { getJdbcStorageDir, saveInstalledDriver } from "@/lib/db/jdbc-install-utils";

export function DriverInstallPrompt({
  open,
  onOpenChange,
  driver,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  driver: JdbcDriverTemplate | null;
  onInstalled: (jarPaths: string[]) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalMb, setTotalMb] = useState(0);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      setDownloading(false);
      setProgress(0);
      setTotalMb(0);
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  }, [open]);

  if (!driver) return null;

  const handleDownload = async () => {
    if (!driver.jarUrl) {
      onOpenChange(false);
      return;
    }
    setDownloading(true);
    setProgress(0);

    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<{ downloaded: number; total: number; percent: number }>(
      "jdbc-download-progress",
      (event) => {
        setProgress(event.payload.percent);
        setTotalMb(event.payload.total / (1024 * 1024));
      },
    );
    unlistenRef.current = unlisten;

    try {
      const dir = await getJdbcStorageDir(driver.name);
      const jarName = driver.jarUrl.split("/").pop() || `${driver.name}.jar`;
      const outPath = `${dir}/${jarName}`;

      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("download_jdbc_driver", { url: driver.jarUrl, outputPath: outPath });

      unlisten();
      unlistenRef.current = null;

      const jarPaths = [outPath];
      await saveInstalledDriver(driver.name, driver.driverClass, jarPaths);
      onInstalled(jarPaths);
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("Download failed:", msg, e);
      alert(`Failed to download driver: ${msg}`);
      setDownloading(false);
      setProgress(0);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Install JDBC Driver</AlertDialogTitle>
          <AlertDialogDescription>
            The driver for <strong>{driver.name}</strong> is not installed.
            {driver.jarUrl
              ? ` Would you like to download and install it now?`
              : ` You'll need to obtain the JAR manually.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {downloading && (
          <div className="px-6 pb-2">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1 text-right">
              {Math.round(progress)}%
              {totalMb > 0 && ` of ${totalMb.toFixed(1)} MB`}
            </p>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={downloading}>Skip</AlertDialogCancel>
          {driver.jarUrl && (
            <AlertDialogAction onClick={handleDownload} disabled={downloading}>
              {downloading ? `Downloading ${Math.round(progress)}%...` : "Download & Install"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
