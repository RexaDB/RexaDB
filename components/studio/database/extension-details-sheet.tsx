"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Box, Check, ExternalLink, RefreshCw } from "@/lib/icon-theme/lucide-react";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import type { DatabaseExtension } from "./extensions-types";

interface ExtensionDetailsSheetProps {
  extension: DatabaseExtension | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleExtension: (name: string, install: boolean) => Promise<void>;
  isLoading?: boolean;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-1 sm:gap-4 border-b border-studio-border/60 py-3">
      <span className="text-xs sm:text-xs tracking-[0.14em] text-muted-foreground/60 shrink-0">
        {label}
      </span>
      <span className="w-full sm:w-auto sm:max-w-[65%] text-left sm:text-right text-xs sm:text-sm text-foreground break-words">
        {value}
      </span>
    </div>
  );
}

export function ExtensionDetailsSheet({
  extension,
  open,
  onOpenChange,
  onToggleExtension,
  isLoading = false,
}: ExtensionDetailsSheetProps) {
  const { appShellLayout } = useGlobalStudioSettings();

  if (!extension) return null;

  const isInstalled = !!extension.installed_version;
  const docsHref = `https://www.postgresql.org/docs/current/${extension.name}.html`;
  const searchHref = `https://www.google.com/search?q=postgresql+extension+${extension.name}`;
  const capabilities = [
    extension.trusted ? "Trusted" : null,
    extension.relocatable ? "Relocatable" : null,
    extension.superuser ? "Requires superuser" : null,
  ].filter(Boolean) as string[];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        contained={appShellLayout}
        className="w-[min(520px,95vw)] bg-studio-bg border-studio-border text-foreground p-0"
      >
        <SheetHeader className="border-b border-studio-border/80 px-4 sm:px-5 py-3 sm:py-4">
          <div className="flex items-start gap-2 sm:gap-3 pr-10 sm:pr-12">
            <div
              className={cn(
                "flex h-9 w-9 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-lg sm:rounded-lg",
                isInstalled
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Box className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 space-y-1 sm:space-y-2">
              <SheetTitle className="truncate text-sm sm:text-sm font-semibold">
                {extension.name}
              </SheetTitle>
              <SheetDescription className="text-xs sm:text-xs text-muted-foreground">
                {extension.comment ||
                  "No extension description is available for this package."}
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <Badge
                  variant={isInstalled ? "secondary" : "outline"}
                  className={cn(
                    "h-4 sm:h-5 px-1.5 sm:px-2 text-xs sm:text-xs",
                    isInstalled &&
                      "bg-emerald-500/10 text-emerald-500 border-none",
                  )}
                >
                  {isInstalled ? (
                    <>
                      <Check className="mr-0.5 sm:mr-1 h-2.5 w-2.5 sm:h-3 sm:w-3" />
                      Installed
                    </>
                  ) : (
                    "Available"
                  )}
                </Badge>
                <Badge
                  variant="outline"
                  className="h-4 sm:h-5 px-1.5 sm:px-2 font-mono text-xs sm:text-xs"
                >
                  v{extension.installed_version || extension.default_version}
                </Badge>
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 sm:py-4">
          <div className="mb-4 sm:mb-5 flex flex-wrap gap-1.5 sm:gap-2">
            <a
              href={searchHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 sm:flex-none"
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-7 sm:h-8 text-xs sm:text-xs w-full"
              >
                Search
                <ExternalLink className="ml-1 h-3 w-3 sm:ml-1.5 sm:h-3.5 sm:w-3.5" />
              </Button>
            </a>
          </div>

          <div className="rounded-lg sm:rounded-lg border border-studio-border/70 bg-background/30 px-3 sm:px-4">
            <DetailRow
              label="Default version"
              value={extension.default_version || "Unknown"}
            />
            <DetailRow
              label="Installed version"
              value={extension.installed_version || "Not installed"}
            />
            <DetailRow
              label="Installed schema"
              value={extension.installed_schema || "Not installed"}
            />
            <DetailRow
              label="Default schema"
              value={extension.default_schema || "Database default"}
            />
            <DetailRow
              label="Dependencies"
              value={extension.requires || "None"}
            />
            <DetailRow
              label="Available versions"
              value={extension.available_versions || extension.default_version}
            />
          </div>

          {capabilities.length > 0 && (
            <div className="mt-4 sm:mt-5">
              <div className="mb-1.5 sm:mb-2 text-xs sm:text-xs tracking-[0.14em] text-muted-foreground/60">
                Capabilities
              </div>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {capabilities.map((capability) => (
                  <Badge
                    key={capability}
                    variant="outline"
                    className="h-5 sm:h-6 px-1.5 sm:px-2 text-xs sm:text-xs"
                  >
                    {capability}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-studio-border/80 bg-background/20 px-4 sm:px-5 py-2.5 sm:py-3">
          <Button
            variant={isInstalled ? "outline" : "default"}
            className={cn(
              "ml-auto h-7 sm:h-8 px-2.5 sm:px-3 text-xs sm:text-xs w-full sm:w-auto",
              isInstalled
                ? "border-red-500/20 text-red-500 hover:bg-red-500/10 hover:border-red-500/30"
                : "bg-primary hover:bg-primary/90 text-primary-foreground",
            )}
            disabled={isLoading}
            onClick={() => void onToggleExtension(extension.name, !isInstalled)}
          >
            {isLoading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : isInstalled ? (
              "Uninstall extension"
            ) : (
              "Install extension"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
