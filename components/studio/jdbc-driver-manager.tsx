"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DEFAULT_TEMPLATES, type JdbcDriverTemplate } from "@/lib/db/jdbc-templates";
import { Search, Download, Trash2 } from "@/lib/icon-theme/lucide-react";
import { type InstalledDriver, loadInstalledDrivers, saveInstalledDriver, removeInstalledDriver } from "@/lib/db/jdbc-install-utils";

const JDBC_DRIVERS_DIR = "jdbc-drivers";

type DownloadProgress = {
  percent: number;
};

export function JdbcDriverManager({
  open,
  onOpenChange,
  onSelectDriver,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelectDriver?: (driver: JdbcDriverTemplate & { jarPaths: string[] }) => void;
}) {
  const [search, setSearch] = useState("");
  const [installed, setInstalled] = useState<InstalledDriver[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, DownloadProgress>>({});

  useEffect(() => {
    if (open) loadInstalled();
  }, [open]);

  const loadInstalled = async () => {
    const result = await loadInstalledDrivers();
    setInstalled(result);
  };

  const filteredTemplates = DEFAULT_TEMPLATES.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.driverClass.toLowerCase().includes(search.toLowerCase())
  );

  const isInstalled = (name: string) => installed.some((i) => i.name === name);
  const getProgress = (name: string) => progressMap[name]?.percent ?? 0;

  const handleInstall = async (template: JdbcDriverTemplate) => {
    if (!template.jarUrl) {
      alert(`No automatic download URL for ${template.name}. Download the JAR manually and place it in the JDBC drivers directory.`);
      return;
    }
    setInstalling(template.name);
    setProgressMap((prev) => ({ ...prev, [template.name]: { percent: 0 } }));

    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<{ percent: number }>(
      "jdbc-download-progress",
      (event) => {
        setProgressMap((prev) => ({
          ...prev,
          [template.name]: { percent: event.payload.percent },
        }));
      },
    );

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { appDataDir } = await import("@tauri-apps/api/path");
      const appDir = await appDataDir();
      const jarName = template.jarUrl.split("/").pop() || `${template.name}.jar`;
      const outputPath = `${appDir}/${JDBC_DRIVERS_DIR}/${template.name}/${jarName}`;
      await invoke("download_jdbc_driver", { url: template.jarUrl, outputPath });
      await saveInstalledDriver(template.name, template.driverClass, [outputPath]);
      await loadInstalled();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("Failed to install driver:", msg, e);
      alert(`Failed to install ${template.name}: ${msg}`);
    } finally {
      unlisten();
      setInstalling(null);
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[template.name];
        return next;
      });
    }
  };

  const handleRemove = async (name: string) => {
    try {
      await removeInstalledDriver(name);
      await loadInstalled();
    } catch (e: any) {
      console.error("Failed to remove driver:", e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh]" style={{ maxWidth: '95vw', width: '95vw' }}>
        <DialogHeader>
          <DialogTitle>JDBC Driver Manager</DialogTitle>
        </DialogHeader>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search drivers..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ScrollArea className="h-[50vh]">
          <div className="space-y-2">
            {filteredTemplates.map((template) => {
              const has = isInstalled(template.name);
              const isDownloading = installing === template.name;
              const pct = getProgress(template.name);
              return (
                <div
                  key={template.name}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors gap-3"
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{template.name}</span>
                      {has && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Installed
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {template.driverClass}
                    </p>
                    {isDownloading && (
                      <div className="mt-2 max-w-[200px]">
                        <Progress value={pct} className="h-1.5" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {onSelectDriver && has && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          const inst = installed.find((i) => i.name === template.name);
                          if (inst) onSelectDriver({ ...template, jarPaths: inst.jarPaths });
                        }}
                      >
                        Select
                      </Button>
                    )}
                    {!has ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => handleInstall(template)}
                        disabled={isDownloading || !template.jarUrl}
                      >
                        {isDownloading ? (
                          <>{Math.round(pct)}%</>
                        ) : (
                          <Download className="h-3.5 w-3.5 mr-1" />
                        )}
                        {isDownloading ? "" : "Install"}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-destructive"
                        onClick={() => handleRemove(template.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredTemplates.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No drivers match "{search}"
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
