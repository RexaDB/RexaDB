"use client";

import {
  Download,
  Upload,
  Loader2,
  FileArchive,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  ChevronDown,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useState, useCallback } from "react";
import { toast } from "sonner";

interface BackupRestoreViewProps {
  connectionString: string;
  dbType: string;
}

function SectionHeader({
  icon,
  iconClass,
  section,
  currentSection,
  onSectionChange,
  description,
}: {
  icon: React.ReactNode;
  iconClass: string;
  section: "backup" | "restore";
  currentSection: "backup" | "restore";
  onSectionChange: (s: "backup" | "restore") => void;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg ${iconClass} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-0.5 text-sm font-semibold text-foreground hover:text-accent-foreground transition-colors">
              {section === "backup" ? "Backup" : "Restore"}
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={2}>
            <DropdownMenuItem onClick={() => onSectionChange("backup")}>
              Backup
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSectionChange("restore")}>
              Restore
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function BackupRestoreView({
  connectionString,
  dbType,
}: BackupRestoreViewProps) {
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [format, setFormat] = useState("custom");
  const [schemaOnly, setSchemaOnly] = useState(false);
  const [dataOnly, setDataOnly] = useState(false);
  const [compress, setCompress] = useState("9");
  const [outputPath, setOutputPath] = useState("");
  const [restoreFile, setRestoreFile] = useState("");
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [section, setSection] = useState<"backup" | "restore">("backup");

  const handleBackup = useCallback(async () => {
    setBackingUp(true);
    try {
      const { runDbBackup } = await import("@/lib/api/actions-client");
      const res = await runDbBackup(connectionString, {
        format: format as any,
        schemaOnly,
        dataOnly,
        compress: parseInt(compress, 10),
        outputPath: outputPath || undefined,
      });
      if (res.success) {
        setLastBackup(res.data?.outputPath || "completed");
        toast.success("Backup completed successfully");
      } else {
        toast.error(res.error || "Backup failed");
      }
    } catch (e: any) {
      toast.error(e.message || "Backup failed");
    } finally {
      setBackingUp(false);
    }
  }, [connectionString, format, schemaOnly, dataOnly, compress, outputPath]);

  const dbLabel = dbType === "postgres" ? "PostgreSQL" : dbType.toUpperCase();

  return (
    <div className="flex-1 overflow-y-auto bg-studio-bg">
      <div className="max-w-5xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-8 lg:space-y-10">
        <div className="flex flex-col gap-1">
          <h1 className="text-sm sm:text-sm font-bold text-foreground tracking-tight">
            Backup & Restore
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Create and restore database backups for {dbLabel}.
          </p>
        </div>

        {section === "backup" ? (
          /* Backkup Section */
          <div className="bg-background/40 border border-studio-border rounded-lg p-4 sm:p-6 space-y-5">
            <SectionHeader
              icon={<Download className="w-4 h-4" />}
              iconClass="bg-primary/10 text-primary"
              section="backup"
              currentSection={section}
              onSectionChange={setSection}
              description="Export database to a file"
            />

            <div className="space-y-4">
              <div className="grid grid-cols-[1fr_auto] gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Format
                  </Label>
                  <Select value={format} onValueChange={setFormat}>
                    <SelectTrigger className="h-8 text-xs bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom" className="text-xs">
                        Custom (.dump) - compressed, flexible
                      </SelectItem>
                      <SelectItem value="plain" className="text-xs">
                        Plain SQL (.sql)
                      </SelectItem>
                      <SelectItem value="tar" className="text-xs">
                        Tar archive (.tar)
                      </SelectItem>
                      {dbType === "postgres" && (
                        <SelectItem value="directory" className="text-xs">
                          Directory (directory format)
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {format !== "plain" && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Compression (0-9)
                    </Label>
                    <div className="flex">
                      <button
                        type="button"
                        onClick={() =>
                          setCompress((v) =>
                            String(Math.max(0, parseInt(v || "0", 10) - 1)),
                          )
                        }
                        className="h-8 w-7 flex items-center justify-center border border-r-0 border-input rounded-l-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-xs bg-transparent shrink-0"
                      >
                        −
                      </button>
                      <Input
                        type="number"
                        min={0}
                        max={9}
                        value={compress}
                        onChange={(e) => setCompress(e.target.value)}
                        className="h-8 w-10 rounded-none text-center px-0 font-mono text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setCompress((v) =>
                            String(Math.min(9, parseInt(v || "0", 10) + 1)),
                          )
                        }
                        className="h-8 w-7 flex items-center justify-center border border-l-0 border-input rounded-r-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-xs bg-transparent shrink-0"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Output Path (optional)
                </Label>
                <div className="flex gap-2">
                  <Input
                    placeholder={`e.g., /tmp/my_db_backup.dump`}
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                    className="h-8 text-xs bg-background/50 font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 text-xs gap-1.5 shrink-0"
                    onClick={async () => {
                      try {
                        const { save } =
                          await import("@tauri-apps/plugin-dialog");
                        const selected = await save({
                          defaultPath: outputPath || undefined,
                          filters: [
                            {
                              name: "Database Backup",
                              extensions: ["dump", "sql", "tar"],
                            },
                          ],
                        });
                        if (selected) setOutputPath(selected);
                      } catch {
                        // fallback — not in Tauri runtime
                      }
                    }}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Browse
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    id="schema-only"
                    checked={schemaOnly}
                    onCheckedChange={(v) => {
                      setSchemaOnly(v);
                      if (v) setDataOnly(false);
                    }}
                  />
                  <Label
                    htmlFor="schema-only"
                    className="text-xs text-muted-foreground cursor-pointer"
                  >
                    Schema only
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="data-only"
                    checked={dataOnly}
                    onCheckedChange={(v) => {
                      setDataOnly(v);
                      if (v) setSchemaOnly(false);
                    }}
                  />
                  <Label
                    htmlFor="data-only"
                    className="text-xs text-muted-foreground cursor-pointer"
                  >
                    Data only
                  </Label>
                </div>
              </div>

              {dbType !== "postgres" && dbType !== "mysql" && (
                <div className="flex items-center gap-2 p-2 bg-amber-500/5 border border-amber-500/20 rounded-lg text-xs text-amber-500">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span>
                    Backup is only supported for PostgreSQL and MySQL
                    connections.
                  </span>
                </div>
              )}
            </div>

            <Button
              onClick={handleBackup}
              disabled={
                backingUp || (dbType !== "postgres" && dbType !== "mysql")
              }
              className="w-full h-8 text-xs gap-1.5"
            >
              {backingUp ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <FileArchive className="w-3 h-3" />
              )}
              {backingUp ? "Backing up..." : "Start Backup"}
            </Button>

            {lastBackup && (
              <div className="flex items-center gap-2 p-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg text-xs text-emerald-500">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>Last backup: {lastBackup}</span>
              </div>
            )}
          </div>
        ) : (
          /* Restore Section */
          <div className="bg-background/40 border border-studio-border rounded-lg p-4 sm:p-6 space-y-5">
            <SectionHeader
              icon={<Upload className="w-4 h-4" />}
              iconClass="bg-amber-500/10 text-amber-500"
              section="restore"
              currentSection={section}
              onSectionChange={setSection}
              description="Import database from a backup file"
            />

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Backup File Path
                </Label>
                <Input
                  placeholder={`e.g., /tmp/my_db_backup.dump`}
                  value={restoreFile}
                  onChange={(e) => setRestoreFile(e.target.value)}
                  className="h-8 text-xs bg-background/50 font-mono"
                />
              </div>

              <div className="flex items-center gap-2 p-2 bg-amber-500/5 border border-amber-500/20 rounded-lg text-xs text-amber-500">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>
                  Restore will overwrite existing data. Make sure you have a
                  backup before proceeding. Only supports pg_restore compatible
                  files.
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              disabled={
                restoring ||
                !restoreFile.trim() ||
                (dbType !== "postgres" && dbType !== "mysql")
              }
              className="w-full h-8 text-xs gap-1.5 border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:border-amber-500/50"
              onClick={async () => {
                setRestoring(true);
                try {
                  toast.info(
                    "Restore functionality requires pg_restore/mysql CLI. Manual restore recommended.",
                  );
                } finally {
                  setRestoring(false);
                }
              }}
            >
              {restoring ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              {restoring ? "Restoring..." : "Start Restore"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
