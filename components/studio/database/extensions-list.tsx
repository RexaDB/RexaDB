"use client";

import { Search, Box, RefreshCw, Check, ExternalLink } from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
import { ExtensionDetailsSheet } from "./extension-details-sheet";
import type { DatabaseExtension } from "./extensions-types";

interface ExtensionsListProps {
  extensions: DatabaseExtension[];
  fetchingExtensions?: boolean;
  onToggleExtension: (name: string, install: boolean) => Promise<void>;
}

export function ExtensionsList({
  extensions,
  fetchingExtensions,
  onToggleExtension,
}: ExtensionsListProps) {
  const [search, setSearch] = useState("");
  const [togglingExtension, setTogglingExtension] = useState<string | null>(
    null,
  );
  const [confirmToggle, setConfirmToggle] = useState<{
    name: string;
    install: boolean;
  } | null>(null);
  const [selectedExtension, setSelectedExtension] =
    useState<DatabaseExtension | null>(null);

  const filteredExtensions = extensions.filter(
    (ext) =>
      ext.name.toLowerCase().includes(search.toLowerCase()) ||
      ext.comment?.toLowerCase().includes(search.toLowerCase()),
  );

  const handleToggle = async (name: string, install: boolean) => {
    setTogglingExtension(name);
    try {
      await onToggleExtension(name, install);
    } finally {
      setTogglingExtension(null);
      setConfirmToggle(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-studio-bg">
      <div className="max-w-5xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-sm sm:text-sm font-bold text-foreground tracking-tight">
            Extensions
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            PostgreSQL extensions provide additional functionality to your
            database.
          </p>
        </div>

        <div className="relative group w-full sm:max-w-md">
          <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors" />
          <Input
            placeholder="Search extensions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 sm:pl-10 h-9 sm:h-10 bg-background/50 border-studio-border focus-visible:ring-primary/50 text-xs sm:text-sm"
          />
        </div>

        {fetchingExtensions ? (
          <div
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            }}
            className="grid gap-3 sm:gap-4"
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-28 sm:h-32 bg-background/20 animate-pulse rounded-lg sm:rounded-lg border border-studio-border min-w-0"
              />
            ))}
          </div>
        ) : (
          <div
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
            className="grid gap-3 sm:gap-4"
          >
            {filteredExtensions.map((ext) => {
              const isInstalled = !!ext.installed_version;
              const isLoading = togglingExtension === ext.name;

              return (
                <div
                  key={ext.name}
                  className={cn(
                    "flex flex-col p-3 sm:p-5 bg-background/40 border border-studio-border rounded-lg transition-all group relative cursor-pointer min-w-0",
                    isInstalled
                      ? "border-primary/20 bg-primary/[0.02]"
                      : "hover:border-studio-border-hover",
                  )}
                  onClick={() => setSelectedExtension(ext)}
                >
                  <div className="flex flex-col sm:flex-row items-start justify-between gap-2 sm:gap-3 mb-2 sm:mb-3">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3 flex-1 w-full sm:w-auto">
                      <div
                        className={cn(
                          "w-8 h-8 sm:w-10 sm:h-10 shrink-0 rounded-lg flex items-center justify-center transition-colors",
                          isInstalled
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground group-hover:bg-muted/80",
                        )}
                      >
                        <Box className="w-4 h-4 sm:w-5 sm:h-5" />
                      </div>
                      <div className="flex min-w-0 flex-col flex-1">
                        <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs sm:text-sm font-semibold text-foreground">
                          {ext.name}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          v{ext.installed_version || ext.default_version}
                        </span>
                      </div>
                    </div>

                    <Button
                      variant={isInstalled ? "outline" : "default"}
                      size="sm"
                      className={cn(
                        "h-6 sm:h-7 shrink-0 px-2.5 sm:px-3 text-xstracking-wider font-bold w-full sm:w-auto",
                        isInstalled
                          ? "border-red-500/20 text-red-500 hover:bg-red-500/10 hover:border-red-500/30"
                          : "bg-primary hover:bg-primary/90 text-primary-foreground border-none",
                      )}
                      disabled={isLoading}
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmToggle({
                          name: ext.name,
                          install: !isInstalled,
                        });
                      }}
                    >
                      {isLoading ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : isInstalled ? (
                        "Uninstall"
                      ) : (
                        "Install"
                      )}
                    </Button>
                  </div>

                  <p className="text-xs sm:text-xs text-muted-foreground line-clamp-2 mb-3 sm:mb-4 flex-1">
                    {ext.comment || "No description provided."}
                  </p>

                  <div className="flex items-center justify-between pt-2 sm:pt-3 border-t border-studio-border/50">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {isInstalled && (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-none text-xs h-4 px-1.5"
                        >
                          <Check className="w-2.5 h-2.5 mr-1" />
                          Installed
                        </Badge>
                      )}
                      {!isInstalled && (
                        <Badge
                          variant="outline"
                          className="text-xs h-4 px-1.5 opacity-50"
                        >
                          Available
                        </Badge>
                      )}
                    </div>

                    <button
                      type="button"
                      className="text-muted-foreground hover:text-primary transition-colors"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedExtension(ext);
                      }}
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredExtensions.length === 0 && (
              <div className="col-span-full py-8 sm:py-12 text-center border-2 border-dashed border-studio-border rounded-lg sm:rounded-2xl px-4">
                <Box className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground/20 mx-auto mb-2 sm:mb-3" />
                <p className="text-xs sm:text-sm text-muted-foreground">
                  No extensions found matching your search.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!confirmToggle}
        onOpenChange={(open) => !open && setConfirmToggle(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmToggle?.install
                ? "Install Extension"
                : "Uninstall Extension"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmToggle?.install
                ? `Are you sure you want to install the "${confirmToggle?.name}" extension? This will add new functionality to your database.`
                : `Are you sure you want to uninstall the "${confirmToggle?.name}" extension? This may cause errors if your database objects depend on it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmToggle?.install
                  ? "bg-primary hover:bg-primary/90"
                  : "bg-red-600 hover:bg-red-500"
              }
              onClick={() =>
                confirmToggle &&
                handleToggle(confirmToggle.name, confirmToggle.install)
              }
            >
              {confirmToggle?.install ? "Install" : "Uninstall"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ExtensionDetailsSheet
        extension={selectedExtension}
        open={!!selectedExtension}
        onOpenChange={(open) => {
          if (!open) setSelectedExtension(null);
        }}
        onToggleExtension={async (name, install) => {
          await handleToggle(name, install);
          setSelectedExtension((current) =>
            current && current.name === name
              ? {
                  ...current,
                  installed_version: install ? current.default_version : null,
                }
              : current,
          );
        }}
        isLoading={
          selectedExtension
            ? togglingExtension === selectedExtension.name
            : false
        }
      />
    </div>
  );
}
